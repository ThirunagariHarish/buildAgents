// Pocket Box Studio: one page, hash routes, live updates over server-sent
// events. No framework; every screen is a function that returns HTML.
(() => {
  'use strict';

  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const S = { session: null, meta: null, agents: [], agent: null, tab: 'thread', devices: null, open: new Set(), files: null, file: null, runs: null, users: null, es: null, version: null };

  // ---- small helpers ----------------------------------------------------------
  const pip = (mood, size, opts) => (self.Pip ? self.Pip.svg(mood, size, opts) : '');
  const pipMini = () => `<span class="pip-mini">${pip('idle', 32, { still: true })}</span>`;
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
    bell: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 1112 0c0 5 2 6.5 2 6.5H4S6 14 6 9z"/><path d="M10 19.5a2.2 2.2 0 004 0"/></svg>',
    grid: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
    plus: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    me: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/></svg>',
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
    const here = location.hash || '#/';
    S.trail = S.trail || [];
    if (S.trail[S.trail.length - 1] !== here) S.trail.push(here);
    if (S.trail.length > 30) S.trail = S.trail.slice(-30);
    const r = route();
    const publicRoutes = ['login', 'signup', 'forgot', 'reset', 'privacy', 'terms'];
    if (!S.session) S.session = await api('/api/session').catch(() => ({ authed: false }));
    if (ticket !== rendering) return;
    if (!S.session.authed && r.name === 's' && r.id) store.set('pb.after', { hash: `#/s/${r.id}`, at: Date.now() });
    if (!S.session.authed && !publicRoutes.includes(r.name)) return go(r.name === 's' ? '#/signup' : '#/login');
    if (S.session.authed && ['login', 'signup'].includes(r.name)) return go('#/');
    if (S.session.authed) { connect(); if (!S.tzSent) { S.tzSent = true; api('/api/me/prefs', { method: 'POST', body: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone } }).catch(() => {}); } }

    let html;
    try { html = await view(r); } catch (e) { html = errorView(e); }
    const navOn = S.session?.authed && NAV_ON[r.name] !== undefined && !(r.name === 'a');
    if (navOn) html += bottomNav(NAV_ON[r.name]);
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
      case 'a': return agentPage(r.id, r.rest[0]);
      case 'agents': return agentsListView();
      case 'new': return newView();
      case 'phones': return phonesView();
      case 'people': return peopleView();
      case 'me': return meView();
      case 'templates': return templatesView(r.id);
      case 'privacy': return legalView('privacy');
      case 'terms': return legalView('terms');
      case 't': return templateView(r.id);
      case 'watch': return watchView();
      case 's': return shareView(r.id);
      case 'updates': return updatesView();
      default: return hubView();
    }
  }

  function after(r) {
    document.body.classList.toggle('has-nav', !!(S.session?.authed && NAV_ON[r.name] !== undefined && r.name !== 'a'));
    document.body.dataset.tab = r.name === 'a' ? S.tab : 'thread';
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
        // Don't redraw the hub under someone who is typing to Pip.
        const ta = $('form[data-form="ask"] textarea');
        if (ta && (ta.value || document.activeElement === ta)) return;
        render({ transition: false });
      }
    }, delay);
  }

  function onEvent(m) {
    const r = route();
    if (m.event === 'users' && r.name === 'people') return render({ transition: false });
    if (m.event === 'prefs' && r.name === 'me') return render({ transition: false });
    if (m.event === 'update') return onUpdate(m.update);
    if (!m.agentId) return;
    const here = r.name === 'a' && r.id === m.agentId && S.agent;
    if (!here) { if (r.name === 'home') softRefresh(600); return; }
    if (m.event === 'deleted') { toast('That agent was deleted.'); return go('#/'); }
    if (m.event === 'chat') { if (S.tab === 'chat') appendChat(m.entries || []); return; }
    if (m.event === 'message') {
      if (!S.agent.messages.some((x) => x.id === m.message.id)) S.agent.messages.push(m.message);
      S.agent.thinking = null;
      // The simple agent page shows your change requests and Pocket Box's answers in its conversation.
      if (!$('#thread') && $('#chat')) {
        const mm = m.message;
        if (mm.kind === 'owner' || mm.agentId === 'system' || mm.kind === 'answer') appendConvo([{ kind: 'crew', id: mm.id, at: mm.ts, mine: mm.kind === 'owner', text: mm.kind === 'owner' ? mm.content : (mm.summary || mm.content) }]);
        return;
      }
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
    // What a run said arrives as an update (banner and conversation); the run itself needs no toast.
    if (m.event === 'run') { if (S.tab === 'runs' && $('#tab-body')) { S.runs = null; softRefresh(100); loadRuns(); } return; }
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
      <div class="row" style="margin-bottom:28px"><div class="brand">${pipMini()}Pocket Box</div><span class="spacer"></span><span data-install-slot="pill">${installPill()}</span></div>
      <div style="display:flex;justify-content:center;margin:-6px 0 6px">${pip('hi', 120)}</div>
      <h1 class="display">Agents that live <em>in your pocket</em>.</h1>
      <p class="muted" style="margin:12px 0 24px">Tell Pip what you need help with: your money, your day, your family, your next trip. Pocket Box sets up an agent that takes care of it and lets you know.</p>
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
      </div>
      <div class="row tiny faint" style="margin-top:18px;justify-content:center;gap:14px"><a href="#/privacy">Privacy</a><a href="#/terms">Terms</a></div>`);
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
    return `<header class="top">
      <button class="btn ghost icon" data-act="back" aria-label="Back">${icon.back}</button>
      <a class="brand" href="#/" style="margin-left:-4px">${pipMini()}<span>Pocket Box</span></a>
      <span class="spacer"></span>${extra}
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


  // ---- ready-made agents ---------------------------------------------------------------------
  async function loadTemplates() {
    if (!S.templates) S.templates = (await api('/api/templates')).templates;
    return S.templates;
  }
  const lifeCard = (t) => `<a class="glass card life-card" href="#/t/${esc(t.id)}" style="text-decoration:none;display:block">
      <div class="row" style="gap:14px;align-items:flex-start"><div class="avatar">${esc(t.icon)}</div><div style="flex:1;min-width:0">
        <div class="h3">${esc(t.name)}</div><div class="small muted" style="margin-top:4px">${esc(t.summary)}</div>
        ${(t.handles || []).length ? `<ul class="small" style="margin:10px 0 0;padding-left:18px;color:var(--ink-2)">${t.handles.slice(0, 3).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${(t.talk || []).length ? `<div class="row wrap" style="gap:6px;margin-top:10px">${t.talk.slice(0, 2).map((x) => `<span class="pill">“${esc(x)}”</span>`).join('')}</div>` : ''}
      </div><span class="faint">›</span></div></a>`;
  const templateCard = (t) => `<a class="glass tpl-card" href="#/t/${esc(t.id)}"><div class="row" style="gap:10px"><div class="avatar sm">${esc(t.icon)}</div><div class="h3">${esc(t.name)}</div></div><div class="small muted" style="margin-top:8px">${esc(t.summary)}</div></a>`;

  async function templatesView(cat) {
    await loadTemplates();
    const cats = [...new Set(S.templates.map((t) => t.category))];
    const shown = cat ? S.templates.filter((t) => t.category === decodeURIComponent(cat)) : S.templates;
    return `<div class="shell">${topBar()}
      <section style="padding:28px 0 18px" class="rise"><h1 class="display" style="font-size:clamp(36px,8vw,52px)">Ready-made <em>agents</em></h1>
        <p class="lede">Tested and signed already. Fill in a detail or two and it starts working: no build, no wait.</p></section>
      <div class="row wrap rise" style="gap:8px;margin-bottom:16px"><a class="chip ${!cat ? 'on' : ''}" href="#/templates">All</a>${cats.map((c) => `<a class="chip ${cat && decodeURIComponent(cat) === c ? 'on' : ''}" href="#/templates/${encodeURIComponent(c)}">${esc(c)}</a>`).join('')}</div>
      ${shown.some((t) => t.tier === 'life') ? `<div class="eyebrow" style="margin:6px 4px 12px">Agents that run part of your life</div><div class="stack rise">${shown.filter((t) => t.tier === 'life').map(lifeCard).join('')}</div>` : ''}
      ${shown.some((t) => t.tier !== 'life') ? `<div class="eyebrow" style="margin:28px 4px 12px">Quick alerts</div><div class="tpl-grid rise">${shown.filter((t) => t.tier !== 'life').map(templateCard).join('')}</div>` : ''}
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
    const box = f.multiline && f.type !== 'secret'
      ? `<textarea class="input" name="v_${esc(f.key)}" rows="4" data-grow placeholder="${esc(f.placeholder || '')}" ${f.optional ? '' : 'required'}>${esc(f.default || '')}</textarea>`
      : `<input class="input" name="v_${esc(f.key)}" type="${type}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${esc(f.default || '')}" placeholder="${esc(f.placeholder || '')}" ${f.optional ? '' : 'required'} autocomplete="off">`;
    return `<label class="field"><span>${esc(f.label)}${f.optional ? ' <span class="faint">(optional)</span>' : ''}</span>
      ${f.help ? `<span class="small muted" style="display:block;margin:2px 4px 8px;font-weight:400">${esc(f.help)}</span>` : ''}${box}</label>`;
  }
  const runsOnPicker = () => `<div class="field"><span>Where it runs</span><div class="tabs" style="background:var(--line)" data-runs><button type="button" class="tab on" data-runs-on="cloud">In the cloud</button><button type="button" class="tab" data-runs-on="phone">On my phone</button></div>
    <p class="tiny faint" style="margin:6px 4px 0">Cloud runs on time even when your phone is off; you get a notification, or an email if no device is set up.</p></div>`;

  async function templateView(id) {
    await loadTemplates();
    const t = S.templates.find((x) => x.id === id);
    if (!t) return errorView(new Error('No such ready-made agent.'));
    return `<div class="shell">
      <header class="top"><button class="btn ghost icon" data-act="back" aria-label="Back">${icon.back}</button></header>
      <section class="rise" style="padding:4px 0 18px"><div class="row" style="gap:16px"><div class="avatar xl">${esc(t.icon)}</div><div><h1 class="h2" style="font-size:26px">${esc(t.name)}</h1><div class="small muted" style="margin-top:4px">${esc(t.category)} · tested and signed</div></div></div>
        <p class="lede" style="margin-top:16px">${esc(t.summary)}</p>
        ${t.examples ? `<div class="row wrap" style="gap:6px;margin-top:12px">${t.examples.map((e) => `<span class="pill">${esc(e)}</span>`).join('')}</div>` : ''}</section>
      ${(t.handles || []).length ? `<section class="glass card stack rise" style="margin-bottom:14px"><div class="h3">What it does</div>
        <ul class="stack small" style="margin:0;padding-left:20px;gap:6px">${t.handles.slice(0, 5).map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
        ${(t.talk || []).length ? `<div class="small muted" style="margin-top:4px">You can tell it things like:</div><div class="row wrap" style="gap:6px">${t.talk.slice(0, 4).map((x) => `<span class="pill">“${esc(x)}”</span>`).join('')}</div>` : ''}</section>` : ''}
      <form data-form="install" data-id="${esc(t.id)}" class="glass card stack rise">
        ${(t.fields || []).filter((f) => !f.optional).map(fieldInput).join('')}
        ${whenPicker(t.when)}
        ${(t.fields || []).some((f) => f.optional) ? `<details><summary class="small" style="cursor:pointer;font-weight:600">More options</summary><div class="stack" style="margin-top:12px">${(t.fields || []).filter((f) => f.optional).map(fieldInput).join('')}</div></details>` : ''}
        <button class="btn accent" style="width:100%">Start ${esc(t.name)}</button>
        <p class="tiny faint" style="margin:0;text-align:center">You can change all of this later.</p>
      </form>
      ${(t.setup || []).length ? `<details class="glass card rise" style="margin-top:14px"><summary class="h3" style="cursor:pointer;font-size:16px">Connect your bank texts or email (optional)</summary>
        <ol class="stack small" style="margin:12px 0 0;padding-left:20px;gap:6px">${t.setup.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}
    </div>`;
  }

  /** Where to go after signing in: a shared link opened before signing in, else home. */
  function afterSignIn() {
    const a = store.get('pb.after', null);
    store.set('pb.after', null);
    return a && /^#\/s\/[\w-]+$/.test(a.hash) && Date.now() - a.at < 3 * 86400000 ? a.hash : '#/';
  }

  // ---- a copy of someone's agent, from a shared link ----------------------------------------------
  const triggerText = (t) => t.type === 'schedule' ? `at ${t.at}${t.days && t.days.length && t.days.length < 7 ? ` on ${t.days.join(', ')}` : ' every day'}`
    : t.type === 'interval' ? `every ${t.minutes >= 60 ? `${t.minutes / 60} h` : `${t.minutes} min`}` : t.type === 'manual' ? 'when you tap Run' : t.type;
  async function shareView(code) {
    const pv = await api(`/api/shares/${encodeURIComponent(code)}`);
    const perms = (pv.permissions || []).map((x) => esc((S.meta?.permissions || {})[x] || x).toLowerCase());
    const hosts = pv.http && pv.http.allow && pv.http.allow.length ? pv.http.allow : null;
    return `<div class="shell">
      <header class="top"><a class="btn ghost icon" href="#/" aria-label="Home">${icon.back}</a></header>
      <section class="rise" style="padding:4px 0 18px"><div class="row" style="gap:16px"><div class="avatar xl">${esc(pv.icon)}</div><div><h1 class="h2" style="font-size:26px">${esc(pv.title)}</h1><div class="small muted" style="margin-top:4px">Shared by ${esc(pv.sharedBy)} · version ${esc(pv.version)}</div></div></div>
        <p class="lede" style="margin-top:16px">${esc(pv.description || '')}</p></section>
      <div class="glass card stack rise">
        <div class="eyebrow">What you get</div>
        <div class="small">Your own copy of ${esc(pv.title)}. It is checked again and signed for you; ${esc(pv.sharedBy)} never sees your settings, its memory or its runs, and changes they make later don't reach your copy.</div>
        <div class="small muted">Runs ${(pv.triggers || []).map(triggerText).map(esc).join(', or ') || 'when you tap Run'}.</div>
        <div class="small muted">It may: ${perms.join('; ') || 'nothing beyond notifying you'}.</div>
        ${hosts ? `<div class="small muted">It reads: ${hosts.map(esc).join(', ')}${pv.http.allowFromSettings ? ', and the address you give it' : ''}.</div>` : pv.http && pv.http.allowFromSettings ? '<div class="small muted">It reads the address you give it.</div>' : ''}
        ${(pv.settings || []).length ? `<div class="small muted">You'll fill in: ${pv.settings.map((x) => esc(x.label) + (x.optional ? ' (optional)' : '')).join(', ')}.</div>` : ''}
      </div>
      <form data-form="share-install" data-code="${esc(code)}" class="glass card stack rise" style="margin-top:14px">
        ${runsOnPicker()}
        <label class="row" style="gap:10px"><input type="checkbox" name="live" style="width:20px;height:20px"><span>Notify me for real right away <span class="small faint">(left off, it first runs quietly so you can see what it would say)</span></span></label>
        <div class="row"><button class="btn accent">Get my copy</button></div>
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

  /** The person's to-do list: each item says what, why, and has one button to do it. */
  function todoView() {
    const items = S.todo || [];
    if (!items.length) return '';
    const card = (t) => `<article class="glass card stack" style="gap:8px">
      <div class="row between" style="gap:10px;align-items:flex-start"><div class="h3" style="font-size:16.5px">${esc(t.title)}</div>${t.owner ? '<span class="pill accent" style="flex:none">Only you</span>' : ''}</div>
      <p class="small muted" style="margin:0">${esc(t.why)}</p>
      <div class="row">${t.href ? `<a class="btn accent sm" href="${esc(t.href)}">${esc(t.action)}</a>` : `<button class="btn ${t.optional ? 'soft' : 'accent'} sm" data-act="todo-steps" data-id="${esc(t.id)}">Show me how</button>`}</div>
    </article>`;
    return `<section class="rise" style="margin-bottom:20px">
      <div class="row between" style="margin:0 4px 12px"><div class="eyebrow">To do · ${items.length}</div></div>
      <div class="stack">${items.map(card).join('')}</div></section>`;
  }
  const linkify = (text) => esc(text).replace(/(https?:\/\/[^\s)]+)/g, (u) => `<a class="link" href="${u}" target="_blank" rel="noopener">${u.replace(/^https:\/\//, '')}</a>`);

  /** "Pause all": a banner while it's on, and the choices to turn it on. */
  const pausedUntil = () => (S.prefs?.pauseUntil && S.prefs.pauseUntil > Date.now() ? S.prefs.pauseUntil : null);
  const pauseWhen = (t) => { const d = new Date(t); const today = d.toDateString() === new Date().toDateString(); return `${today ? '' : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, `}${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; };
  function pausedBanner() {
    const u = pausedUntil();
    return u ? `<div class="glass card row between rise" style="gap:12px;margin-bottom:16px"><span class="small"><strong>All agents paused</strong> <span class="muted">until ${esc(pauseWhen(u))}. They still run; you'll see what they said here.</span></span><button class="btn soft sm" data-act="pause-all" data-for="off">Resume</button></div>` : '';
  }
  function pauseControls() {
    const u = pausedUntil();
    return `<div class="field"><span>Pause all agents</span><div class="row wrap" style="gap:8px">${u
      ? `<span class="small muted" style="align-self:center">Paused until ${esc(pauseWhen(u))}</span><button type="button" class="chip" data-act="pause-all" data-for="off">Resume now</button>`
      : '<button type="button" class="chip" data-act="pause-all" data-for="60">1 hour</button><button type="button" class="chip" data-act="pause-all" data-for="morning">Until tomorrow 8:00</button><button type="button" class="chip" data-act="pause-all" data-for="week">A week</button>'}</div></div>`;
  }

  function agentCard(a) {
    const line = a.shared ? `Shared with you${a.lastRun ? ` · last run ${ago(a.lastRun.at)}` : ''}` : a.needsYou && a.mine ? a.needsYou
      : a.lastRun ? `${a.lastRun.ok ? 'Last run' : 'Last run failed'} ${ago(a.lastRun.at)} · ${a.lastRun.summary || ''}`
      : a.release ? `Version ${a.release.version} · ${a.release.channel}` : stageName(a);
    return `<a class="glass agent-card rise" href="#/a/${a.id}${a.mine && a.needsYou && /settings/.test(a.needsYou) ? '/settings' : ''}">
      <div class="avatar">${esc(a.icon || '✳︎')}</div>
      <div class="meta"><div class="title">${esc(a.title)}</div><div class="sub">${esc(line)}</div></div>
      ${statusPill(a)}
    </a>`;
  }

  // ---- an agent ------------------------------------------------------------------
  async function agentView(id, tab) {
    if (!S.agent || S.agent.id !== id) { S.tab = 'thread'; S.runs = null; S.files = null; S.file = null; S.open = new Set(); S.chat = null; S.firstOpen = id; }
    // A link straight to a tab (#/a/<id>/settings) opens it once, then the address goes back to the agent.
    if (['thread', 'runs', 'settings', 'code'].includes(tab)) { S.tab = tab; history.replaceState(null, '', `#/a/${id}`); }
    const [a, meta] = await Promise.all([api(`/api/agents/${id}`), S.meta ? S.meta : api('/api/meta')]);
    S.agent = a; S.meta = meta;
    if (S.firstOpen === a.id && talks(a) && S.tab === 'thread' && !tab) S.tab = 'chat';
    S.firstOpen = null;
    if (S.tab === 'chat') await loadChat();
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
      ${talks(a) && a.talk.message ? `<form data-form="chat" class="composer glass slim">
        <textarea name="text" data-grow rows="1" placeholder="Talk to ${esc(a.title)}…"></textarea>
        <div class="bar"><span class="spacer"></span>${micButton()}<button class="send" aria-label="Send" disabled>${icon.send}</button></div>
      </form>` : ''}
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
      ${a.missingSettings?.length && a.package && a.ownerId === S.session.user.id && S.tab !== 'settings' ? `<div class="glass card stack" style="margin-top:14px;border:1.5px solid var(--warn, #e0a030)">
        <div class="h3">One step left: fill in ${a.missingSettings.length === 1 ? '1 value' : `${a.missingSettings.length} values`}</div>
        <p class="small muted" style="margin:0">It can't run until you tell it: ${esc(a.missingSettings.join(', '))}.</p>
        <div class="row"><button class="btn accent sm" data-act="tab" data-tab="settings">Fill them in</button></div></div>` : ''}
    </section>`;
  }

  const talks = (a) => !!(a.package && a.talk && (a.talk.message || a.talk.inbox));
  function tabsView(a) {
    const tabs = talks(a) ? [['chat', 'Chat'], ['runs', 'Runs'], ['settings', 'Settings'], ['thread', 'Build']] : [['thread', 'Thread']];
    if (a.package && !talks(a)) tabs.push(['runs', 'Runs'], ['settings', 'Settings']);
    if (a.stage !== 'room' && a.stage !== 'brief') tabs.push(['code', 'Code']);
    if (!tabs.some(([k]) => k === S.tab)) S.tab = 'thread';
    return `<div id="tabs" class="tabs glass" role="tablist" style="margin-top:18px">${tabs.map(([k, l]) => `<button class="tab ${S.tab === k ? 'on' : ''}" role="tab" aria-selected="${S.tab === k}" data-act="tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  }

  function tabBody(a) {
    if (S.tab === 'chat') return chatTab(a);
    if (S.tab === 'runs') return runsTab(a);
    if (S.tab === 'settings') return settingsTab(a);
    if (S.tab === 'code') return codeTab(a);
    return `${tasksView(a)}<div class="thread" id="thread">${a.messages.map((m) => msgView(m)).join('')}</div><div id="thinking-slot" style="margin-top:14px">${a.running ? thinkingView(a.thinking) : ''}</div>`;
  }

  // ---- talking to an agent ----
  async function loadChat() {
    try { S.chat = (await api(`/api/agents/${S.agent.id}/chat`)).entries; } catch (e) { S.chat = []; toast(e.message, 'bad'); }
  }
  const linkBtn = (l) => (l && /^(https|mailto|tel|sms):/.test(l.url) ? `<a class="btn soft sm" style="margin-top:8px" href="${esc(l.url)}" ${l.url.startsWith('https') ? 'target="_blank" rel="noopener"' : ''}>${esc(l.label || 'Open')}</a>` : '');
  function chatEntry(e, a) {
    const when = new Date(e.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (e.role === 'you') return `<div class="chat-row you" data-id="${esc(e.id)}"><div class="bubble you">${esc(e.text)}</div><div class="tiny faint">${a.role === 'member' || (a.members || []).length ? `${esc(e.name || '')} · ` : ''}${when}</div></div>`;
    if (e.role === 'inbox') return `<div class="chat-row inbox" data-id="${esc(e.id)}"><div class="tiny faint">📥 Arrived in its inbox · ${when}</div><div class="small muted bubble-inbox">${esc(e.text.slice(0, 280))}${e.text.length > 280 ? '…' : ''}</div></div>`;
    return `<div class="chat-row agent" data-id="${esc(e.id)}"><div class="avatar sm">${esc(a.icon || '✳︎')}</div><div style="min-width:0"><div class="bubble agent ${e.error ? 'bad' : ''}">${esc(e.text)}</div>${linkBtn(e.link)}<div class="tiny faint">${when}</div></div></div>`;
  }
  function chatTab(a) {
    const entries = S.chat || [];
    const ex = (a.talk && a.talk.examples) || [];
    const intro = !entries.length ? `<section class="glass card stack" style="margin-bottom:14px"><div class="h3">Talk to ${esc(a.title)}</div>
      <p class="small muted" style="margin:0">${a.talk.message ? 'Tell it things in plain words, or ask it anything about what it keeps track of. Try one of these:' : 'Things sent to its inbox show up here, with what it did about them.'}</p></section>` : '';
    return `${intro}<div class="chat" id="chat">${entries.map((e) => chatEntry(e, a)).join('')}</div>
      <div id="chat-typing" class="chat-row agent" hidden><div class="avatar sm">${esc(a.icon || '✳︎')}</div><div class="bubble agent"><span class="dots"><i></i><i></i><i></i></span></div></div>
      ${a.talk.message && ex.length ? `<div class="row wrap" style="gap:8px;margin-top:14px">${ex.map((x) => `<button class="chip" data-act="say" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}`;
  }
  function appendChat(entries) {
    const list = $('#chat');
    if (!list || !S.agent) return;
    S.chat = S.chat || [];
    for (const e of entries) {
      if (S.chat.some((x) => x.id === e.id)) continue;
      S.chat.push(e);
      list.insertAdjacentHTML('beforeend', chatEntry(e, S.agent));
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }
  async function sayToAgent(text) {
    const a = S.agent;
    if (!a || !text.trim()) return;
    const tmp = { id: `tmp${Date.now()}`, at: Date.now(), role: 'you', name: S.session.user.firstName, text };
    appendChat([tmp]);
    const typing = $('#chat-typing'); if (typing) typing.hidden = false;
    try {
      const r = await api(`/api/agents/${a.id}/chat`, { method: 'POST', body: { text } });
      document.querySelector(`[data-id="${tmp.id}"]`)?.remove();
      S.chat = S.chat.filter((x) => x.id !== tmp.id);
      appendChat(r.entries);
    } catch (e) { toast(e.message, 'bad'); }
    finally { const t = $('#chat-typing'); if (t) t.hidden = true; }
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
      if (a.package && !mine && a.role === 'member') b.push('<button class="btn accent" data-act="run-cloud">Run it</button>');
      if (a.package && mine && a.missingSettings?.length && S.tab !== 'settings') b.push('<button class="btn accent" data-act="tab" data-tab="settings">Fill in its settings</button>');
      if (a.package && mine) {
        if (a.package.channel === 'shadow') b.push('<button class="btn accent" data-act="channel" data-channel="live">Go live</button>');
        if (a.package.channel === 'live') b.push('<button class="btn soft sm" data-act="channel" data-channel="shadow">Back to shadow</button>');
        if (a.package.channel === 'off') b.push('<button class="btn sm" data-act="channel" data-channel="shadow">Turn on in shadow</button>');
      }
    }
    if (mine) b.push('<button class="btn soft sm" data-act="to-thread">Message the crew</button>');
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
        <span class="tiny faint">v${esc(r.version)} · ${r.steps} steps · ${Math.round(r.durationMs)} ms${r.httpReads ? ` · ${r.httpReads} web reads` : ''}${(r.webhooks || []).length ? ` · ${r.webhooks.filter((w) => w.sent).length}/${r.webhooks.length} webhook${r.webhooks.length === 1 ? '' : 's'} sent` : ''}${r.handoffs ? ` · ${r.handoffs} hand-offs` : ''}</span>
        <span class="row" style="gap:4px">${r.log.length ? `<button class="btn ghost sm" data-act="runlog" data-id="${esc(r.id)}">Log</button>` : ''}${a.ownerId === S.session.user.id ? `<button class="btn soft sm" data-act="wrong" data-id="${esc(r.id)}">This was wrong</button>` : ''}</span>
      </div>
    </article>`).join('')}</div>`;
  }

  // ---- settings ----
  /** One setting: a short name, its explanation, and a box sized for what it holds. */
  const settingField = (mine) => (s) => {
    const type = s.type === 'secret' ? 'password' : s.type === 'number' ? 'number' : s.type === 'url' ? 'url' : s.type === 'time' ? 'time' : 'text';
    const needed = !s.optional && !s.set;
    const attrs = `name="${esc(s.key)}" ${!mine ? 'disabled' : ''} autocomplete="off" placeholder="${esc(s.type === 'secret' && s.set ? 'Saved — type to replace' : s.placeholder || '')}"`;
    const box = s.multiline && s.type !== 'secret'
      ? `<textarea class="input" ${attrs} rows="4" data-grow style="resize:vertical">${esc(s.value)}</textarea>`
      : `<input class="input" ${attrs} type="${type}" value="${s.type === 'secret' ? '' : esc(s.value)}">`;
    return `<label class="field"><span>${esc(s.label)}${needed ? ' <span class="pill warn" style="margin-left:6px">needed</span>' : s.optional ? ' <span class="faint">(optional)</span>' : ''}</span>
      ${s.help ? `<span class="small muted" style="display:block;margin:2px 4px 8px;font-weight:400">${esc(s.help)}</span>` : ''}${box}</label>`;
  };

  function settingsTab(a) {
    const mine = a.ownerId === S.session.user.id;
    const p = a.package;
    const perms = S.meta?.permissions || {};
    const trig = (t) => t.type === 'schedule' ? `Every ${t.days?.length ? t.days.join(', ') : 'day'} at ${t.at}` : t.type === 'interval' ? `Every ${t.minutes >= 60 ? `${t.minutes / 60} h` : `${t.minutes} min`} while it can` : t.type === 'manual' ? 'When you tap Run' : 'Each time the Runtime opens';
    const snoozed = a.snoozeUntil && a.snoozeUntil > Date.now();
    return `<div class="stack-lg">
      ${a.settings.length ? `<form data-form="settings" class="glass card stack" id="values">
        <div class="h3">${a.missingSettings?.length && mine ? `Fill these in to start it` : 'Your values'}</div>
        <p class="small muted" style="margin:4px 0 0">${a.missingSettings?.length && mine ? `It can't run until the ones marked <span class="pill warn">needed</span> are filled in. ` : ''}Kept on your Studio and used only when this agent runs.${a.settings.some((s) => s.type === 'secret') ? ' Secrets are never shown again after saving.' : ''}</p>
        ${a.settings.map(settingField(mine)).join('')}
        ${mine ? '<div class="row"><button class="btn accent sm">Save</button></div>' : ''}
      </form>` : ''}
      ${mine && a.inboxUrl ? `<section class="glass card stack">
        <div class="h3">Its private inbox</div>
        <p class="small muted" style="margin:0">Anything sent to this address goes straight to ${esc(a.title)}: bank texts, Apple Pay purchases, forwarded emails. Keep it to yourself; anyone with it can send it things.</p>
        <input class="input mono" readonly value="${esc(a.inboxUrl)}" data-inbox-url style="font-size:13px">
        <div class="row wrap" style="gap:8px"><button class="btn accent sm" data-act="inbox-copy">Copy address</button><button class="btn soft sm" data-act="inbox-help">Set it up on my phone</button><button class="btn ghost sm" data-act="inbox-rotate">New address</button></div>
      </section>` : ''}
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
      ${mine ? `<section class="glass card stack">
        <div class="h3">How it tells you</div>
        <div class="row wrap" style="gap:8px">${[['normal', 'Normal'], ['quiet', 'Quietly'], ['urgent', 'Urgent'], ['digest', 'In my daily digest']].map(([k, l]) => `<button class="chip ${(a.notifyStyle || 'normal') === k ? 'on' : ''}" data-act="style" data-style="${k}">${l}</button>`).join('')}</div>
        <p class="small muted" style="margin:0">${{ normal: 'A normal notification.', quiet: 'Arrives without sound or buzz.', urgent: 'Stays on screen and gets through quiet hours. Use it for things that can\'t wait.', digest: 'Nothing buzzes; what it says is collected and sent once a day (time under You).' }[a.notifyStyle || 'normal']}</p>
      </section>
      <section class="glass card stack">
        <div class="h3">Shared with</div>
        <p class="small muted" style="margin:0">They get its notifications and can run it (for example, tap "I'm OK"). Only you can change it.</p>
        ${(a.members || []).map((m) => `<div class="row between"><span>${esc(m.name)} <span class="small faint">${esc(m.email)}</span></span><button class="btn ghost sm" data-act="unshare" data-user="${esc(m.userId)}">Remove</button></div>`).join('')}
        ${(a.invites || []).map((e) => `<div class="row between"><span>${esc(e)} <span class="pill">invited</span></span><button class="btn ghost sm" data-act="uninvite" data-email="${esc(e)}">Remove</button></div>`).join('')}
        <form data-form="share" class="row" style="gap:8px"><input class="input" name="email" type="email" placeholder="their@email.com" required style="flex:1"><button class="btn sm">Share</button></form>
      </section>` : ''}

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
      if (u.status === 'unverified') x.push(['resend', 'Send link', 'btn sm'], ['disable', 'Disable', 'btn ghost sm']);
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
        <div class="row wrap" style="gap:6px">${u.primary ? '' : `<select class="input" style="width:auto;padding:6px 10px;font-size:13px" data-plan-for="${esc(u.id)}">${['free', 'plus', 'family', 'business'].map((x) => `<option value="${x}" ${(u.plan || 'free') === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`}${acts(u)}</div></div>`).join('')}</div>
    </div>`;
  }

  // ---- you ------------------------------------------------------------------------
  async function meView() {
    const [{ about }, pk, pr, pl, tg] = await Promise.all([api('/api/me/about'), api('/api/push/key').catch(() => ({ devices: 0 })), api('/api/me/prefs').catch(() => ({})), api('/api/me/plan').catch(() => null), api('/api/me/telegram').catch(() => ({ available: false }))]);
    S.prefs = pr.prefs; S.prefsMail = pr.mailConfigured;
    const u = S.session.user;
    const theme = store.get('pb.theme', 'system');
    return `<div class="shell">${topBar()}
      <section style="padding:14px 0 16px" class="rise"><h1 class="display" style="font-size:clamp(36px,10vw,52px)">${esc(u.firstName)}<em>.</em></h1><p class="lede" style="margin-top:4px">${esc(u.email)}</p></section>
      <div class="stack-lg">
        <section class="glass card stack rise">
          <div class="h3">Notifications</div>
          ${'Notification' in window && Notification.permission === 'granted' && pk.devices
            ? `<p class="small muted" style="margin:0">On for ${pk.devices} device${pk.devices === 1 ? '' : 's'}. Not seeing them? Send a test.</p><div class="row wrap" style="gap:8px"><button class="btn soft sm" data-act="push-test">Send a test</button><button class="btn ghost sm" data-act="push-on">Turn on for this device again</button></div>`
            : `<p class="small muted" style="margin:0">${/iPhone|iPad/.test(navigator.userAgent) && !standalone() ? 'On iPhone, add Pocket Box to your Home Screen first, open it from there, then turn notifications on.' : 'Turn them on so your agents can reach you on this device.'}</p><div class="row wrap" style="gap:8px">${/iPhone|iPad/.test(navigator.userAgent) && !standalone() ? '<button class="btn accent sm" data-act="install">Add to Home Screen</button>' : '<button class="btn accent sm" data-act="push-on">Turn on notifications</button>'}</div>`}
        </section>
        ${u.role === 'admin' ? '<a class="glass card row agent-row rise" href="#/people"><div class="avatar">👥</div><div style="flex:1"><div class="h3" style="font-size:16px">People</div><div class="small muted">Accounts, plans and invitations</div></div><span class="faint">›</span></a>' : ''}
        ${pl ? planSection(pl) : ''}
        <form data-form="about" class="glass card stack rise">
          <div class="h3">About me</div>
          <p class="small muted" style="margin:0">The room's "Your Voice" speaks for you from this: your routine, where you live and work, what annoys you. Keep it short.</p>
          <textarea class="textarea input" name="about" data-grow rows="4" placeholder="I work 9–6 in Austin, commute by bike, hate notifications before 7…">${esc(about || '')}</textarea>
          <div class="row"><button class="btn sm">Save</button></div>
        </form>
        <form data-form="prefs" class="glass card stack rise">
          <div class="h3">How agents reach you</div>
          <label class="row" style="gap:10px"><input type="checkbox" name="emailAgents" ${S.prefs?.emailAgents ? 'checked' : ''} style="width:20px;height:20px"><span>Also email me what my live agents say${S.prefsMail === false ? ' <span class="small faint">(email isn\'t set up on the server)</span>' : ''}</span></label>
          ${pauseControls()}
          <div class="field"><span>Quiet hours</span><div class="row" style="gap:8px"><input class="input" type="time" name="quietFrom" value="${esc(S.prefs?.quietFrom || '')}" style="flex:1;min-width:0"><span class="small muted">to</span><input class="input" type="time" name="quietTo" value="${esc(S.prefs?.quietTo || '')}" style="flex:1;min-width:0"></div></div>
          <div class="field"><span>Daily digest at</span><input class="input" type="time" name="digestAt" value="${esc(S.prefs?.digestAt || '18:00')}" style="max-width:50%"></div>
          ${tg.available || tg.linked ? `<div class="row between" style="gap:10px"><span class="small"><strong>Telegram</strong> <span class="muted">${tg.linked ? `connected${tg.name ? ` to ${esc(tg.name)}` : ''}` : 'get agents\' messages in Telegram too'}</span></span>${tg.linked ? '<button type="button" class="btn ghost sm" data-act="tg-off">Disconnect</button>' : '<button type="button" class="btn soft sm" data-act="tg-on">Connect</button>'}</div>` : ''}
          <p class="small muted" style="margin:0">During quiet hours agents still run; only urgent ones buzz. Time zone: ${esc(S.prefs?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone)}.</p>
          <div class="row"><button class="btn sm">Save</button></div>
        </form>
        <a class="glass card row agent-row rise" href="#/phones"><div class="avatar">📱</div><div style="flex:1"><div class="h3" style="font-size:16px">Run agents on this phone</div><div class="small muted">Only for agents that need your location. Everything else runs in the cloud.</div></div><span class="faint">›</span></a>
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
        <section class="glass card stack rise">
          <div class="h3">Your data</div>
          <p class="small muted" style="margin:0">Download everything Pocket Box keeps about you, or delete your account and all your agents. <a class="link" href="#/privacy">Privacy</a> · <a class="link" href="#/terms">Terms</a></p>
          <div class="row wrap" style="gap:8px"><a class="btn soft sm" href="/api/me/export" download>Download my data</a>${u.primary ? '' : '<button class="btn danger sm" data-act="delete-account">Delete my account</button>'}</div>
        </section>
        <div class="row rise"><button class="btn ghost" data-act="logout">Sign out</button></div>
      </div>
    </div>`;
  }

  function planSection(pl) {
    const p = pl.plan, u = pl.usage;
    const meter = (used, max, unit) => (max == null ? `<div class="small row between"><span class="muted">${unit}</span><span>unlimited</span></div>` : `<div class="small"><div class="row between"><span class="muted">${unit}</span><span>${used} of ${max}</span></div><div style="height:6px;border-radius:3px;background:var(--line);margin-top:6px;overflow:hidden"><div style="height:100%;width:${Math.min(100, Math.round((used / max) * 100))}%;background:linear-gradient(90deg,#7a64ff,#e46fa0)"></div></div></div>`);
    return `<section class="glass card stack rise">
      <div class="row between"><div class="h3">Plan</div><span class="pill accent">${esc(p.name)}</span></div>
      ${meter(u.builds, p.builds, 'Custom agents this month')}
      ${meter(pl.agents, p.agents, 'Agents')}
      ${p.spendUsd == null ? '' : meter(Number(u.spendUsd.toFixed(2)), p.spendUsd, 'AI use this month (USD)')}
      ${p.id === 'owner' ? '<p class="small muted" style="margin:0">You own this Pocket Box: no limits, and your agents run on your own Claude login.</p>' : `
        <div class="tpl-grid">${pl.plans.filter((x) => x.id !== 'free').map((x) => `<div class="glass" style="padding:14px;border-radius:var(--r-md)"><div class="row between"><span class="h3">${esc(x.name)}</span><span class="small">USD ${x.priceUsd}/mo</span></div>
          <div class="small muted" style="margin-top:6px">${x.builds} custom a month · ${x.agents} agents${x.members ? ` · share with ${x.members}` : ''}</div>
          ${p.id === x.id ? '<div class="pill good" style="margin-top:10px">Your plan</div>' : pl.payments && x.buyable ? `<button class="btn sm" style="margin-top:10px" data-act="upgrade" data-plan="${x.id}">Choose ${esc(x.name)}</button>` : ''}</div>`).join('')}</div>
        ${pl.payments ? (pl.hasSubscription ? '<div class="row"><button class="btn soft sm" data-act="billing-portal">Manage or cancel</button></div>' : '') : '<p class="small muted" style="margin:0">Paid plans open soon.</p>'}`}
    </section>`;
  }

  function legalView(kind) {
    const back = S.session?.authed ? '#/me' : '#/login';
    const privacy = `<h1 class="display" style="font-size:40px">Privacy</h1>
      <p><strong>What Pocket Box keeps.</strong> Your name, email and phone; your agents (what you asked for, the room's and crew's notes, the code); the values you give your agents' settings; a record of each run (when, what it said); your paired devices; and your preferences.</p>
      <p><strong>Where your agents run.</strong> On your phone, or, if you choose "In the cloud", on Pocket Box's server in a sealed process with no other access. Agents can only read web addresses listed in their manifest or the pages you give them, and only through Pocket Box.</p>
      <p><strong>AI.</strong> Designing and building an agent, answering your questions and hand-offs send the relevant text to Anthropic's Claude. Ready-made agents and ordinary runs use no AI.</p>
      <p><strong>What we never do.</strong> Sell your data, show you ads, or read your email, messages or other apps.</p>
      <p><strong>Your control.</strong> Under You → Your data you can download everything we keep, or delete your account; deleting removes your agents, their settings, runs and devices.</p>
      <p><strong>Contact.</strong> The administrator of this Pocket Box.</p>`;
    const terms = `<h1 class="display" style="font-size:40px">Terms</h1>
      <p><strong>What it is.</strong> Pocket Box helps you make personal agents that remind, watch and summarise. They can be wrong or late: a missed run or a wrong number is possible. Don't rely on an agent where a mistake could hurt someone.</p>
      <p><strong>Not advice.</strong> Health, medication, money and care agents are reminders, not medical, financial or professional advice.</p>
      <p><strong>Fair use.</strong> Don't use agents to overload websites, break a site's terms, or collect other people's personal data. We may pause agents that do.</p>
      <p><strong>Plans.</strong> Paid plans renew monthly until cancelled under You → Plan → Manage. Limits reset on the 1st of each month.</p>
      <p><strong>Changes.</strong> We may change these terms; we'll tell you in the app first.</p>`;
    return `<div class="shell"><header class="top"><a class="btn ghost icon" href="${back}" aria-label="Back">${icon.back}</a></header>
      <article class="glass card prose rise" style="font-size:16px">${kind === 'privacy' ? privacy : terms}<p class="small muted">Last updated October 2026.</p></article></div>`;
  }

  // ===================== The hub: one screen everything starts from =====================
  const IDEAS = [['💰', 'Track my spending', 'money-manager'], ['🧭', 'Plan my day', 'chief-of-staff'], ['👀', 'Watch a page', '#/watch'], ['💊', 'Medicine reminders', 'care-manager'],
    ['🧑‍💼', 'Find me a job', 'job-hunter'], ['✈️', 'My next trip', 'trip-concierge'], ['🛂', 'Green card dates', 'visa-tracker'], ['🏡', 'Family chores', 'family-hub'], ['📈', 'My stocks', 'portfolio-watch'], ['🧠', 'Learn something', 'learning-coach']];
  // What someone types → the ready-made agent that already does it.
  const MATCH = [
    [/visa|green ?card|priority date|bulletin|uscis|immigra/i, 'visa-tracker'],
    [/watch (a |this |the )?(web ?)?(page|site)|website chang|price drop|back in stock|restock/i, '#/watch'],
    [/spend|spent|budget|expense|money|financ|subscription|bank|bills?\b/i, 'money-manager'],
    [/medicin|meds\b|pill|dose|caregiv|elderly|my (mom|dad|mother|father)'?s? health/i, 'care-manager'],
    [/\bjobs?\b|career|hiring|resume|interview|apply/i, 'job-hunter'],
    [/stock|portfolio|crypto|bitcoin|invest|shares/i, 'portfolio-watch'],
    [/trip|flight|travel|hotel|vacation|itinerar/i, 'trip-concierge'],
    [/learn|flashcard|vocab|study|quiz me|language/i, 'learning-coach'],
    [/family|chore|grocer|household|kids/i, 'family-hub'],
    [/remind|to-?do|task|plan my day|my day|calendar|organi[sz]/i, 'chief-of-staff'],
  ];
  function matchIdea(text) { for (const [re, id] of MATCH) if (re.test(text)) return id; return null; }

  async function hubView() {
    const [ag, up] = await Promise.all([
      api('/api/agents'),
      api('/api/updates').catch(() => ({ updates: [], unread: 0, devices: 0 })),
      api('/api/me/todo').then((x) => { S.todo = x.items; }).catch(() => { S.todo = []; }),
      loadTemplates().catch(() => {}),
      api('/api/me/prefs').then((x) => { S.prefs = x.prefs; }).catch(() => {}),
    ]);
    S.agents = ag.agents; S.unread = up.unread; S.pushDevices = up.devices;
    const name = S.session.user?.firstName || '';
    const agents = S.agents;
    const needs = agents.filter((x) => x.mine && x.needsYou);
    const latest = up.updates.slice(0, 3);
    const n = agents.length;
    let mood = 'happy', line;
    if (!n) { mood = 'hi'; line = `Hi${name ? ` ${name}` : ''}! I'm Pip. Tell me what you'd like help with and I'll set up an agent for it.`; }
    else if (pausedUntil()) { mood = 'sleep'; line = 'Shh… all your agents are paused. Resume them whenever you\'re ready.'; }
    else if (needs.length) { mood = 'think'; line = `${needs[0].title} needs you: ${needs[0].needsYou.replace(/:.*$/, '').toLowerCase()}.${needs.length > 1 ? ` (${needs.length - 1} more too.)` : ''}`; }
    else if (up.unread) { mood = 'wow'; line = `${up.unread} new update${up.unread === 1 ? '' : 's'}!${latest[0] ? ` ${latest[0].agent}: “${latest[0].title}”` : ''}`; }
    else { line = `All quiet. Your ${n} agent${n === 1 ? ' is' : 's are'} on it.`; }
    const tile = (href, cls, ic, title, sub, badge = 0) => `<a class="tile ${cls}" href="${href}"><span class="ti">${ic}</span>${badge ? `<b class="badge">${Math.min(badge, 99)}</b>` : ''}<span class="tt">${title}</span><span class="ts">${esc(sub)}</span></a>`;
    const st = (x) => plainStatus(x).tone || '';
    return `<div class="shell hub">
      <header class="top"><span class="brand">${pipMini()}<span>Pocket Box</span></span><span class="spacer"></span><a class="btn ghost icon" href="#/me" aria-label="You">${icon.user}</a></header>
      <section class="hub-hero rise"><div class="pip-wrap">${pip(mood, 124)}</div>
        <div class="speech"><div class="eyebrow">${esc(greeting())}${name ? `, ${esc(name)}` : ''}</div><p>${esc(line)}</p>
          ${needs.length ? `<a class="btn accent sm" style="margin-top:10px" href="#/a/${needs[0].id}${/settings/.test(needs[0].needsYou) ? '/settings' : ''}">Take a look</a>` : ''}
          ${!needs.length && pausedUntil() ? '<button class="btn accent sm" style="margin-top:10px" data-act="pause-all" data-for="off">Wake them up</button>' : ''}</div></section>
      <form data-form="ask" class="composer glass ask rise">
        <textarea name="text" data-grow rows="1" placeholder="What should I take care of?" aria-label="What should I take care of?"></textarea>
        <div class="bar"><span class="small faint">Tell Pip in your own words</span><span class="spacer"></span>${micButton()}<button class="send" aria-label="Go" disabled>${icon.send}</button></div>
      </form>
      <div id="ask-reply"></div>
      <div class="row chips-scroll rise" style="gap:8px;margin-top:12px">${IDEAS.map(([e, l, id]) => `<a class="chip" href="${id.startsWith('#') ? id : `#/t/${id}`}">${e} ${esc(l)}</a>`).join('')}</div>
      ${notifyCard(up.devices)}
      <div class="tiles rise">
        ${tile('#/updates', 't-up', '🔔', 'Updates', up.unread ? `${up.unread} new` : up.updates.length ? 'All caught up' : 'Nothing yet', up.unread)}
        ${tile('#/agents', 't-ag', '🤖', 'My agents', n ? `${n} agent${n === 1 ? '' : 's'}${needs.length ? ` · ${needs.length} need${needs.length === 1 ? 's' : ''} you` : ''}` : 'None yet', needs.length)}
        ${tile('#/new', 't-new', '✨', 'New agent', 'Describe one or pick a ready-made')}
        ${tile('#/me', 't-me', '⚙️', 'You', S.prefs?.pauseUntil > Date.now() ? 'All paused' : 'Notifications, plan')}
      </div>
      ${n ? `<div class="hub-sec"><div class="eyebrow">Your agents</div><a class="link small" href="#/agents">See all</a></div>
        <div class="bubbles rise">${agents.map((x) => `<a class="bubble-agent" href="#/a/${x.id}"><span class="avatar">${esc(x.icon || '✳︎')}<i class="st ${st(x)}"></i></span><span class="nm">${esc(x.title)}</span></a>`).join('')}
          <a class="bubble-agent add" href="#/new"><span class="avatar">${icon.plus}</span><span class="nm">New</span></a></div>` : ''}
      ${latest.length ? `<div class="hub-sec"><div class="eyebrow">Latest</div><a class="link small" href="#/updates">See all</a></div><div class="stack" id="updates">${latest.map(updateCard).join('')}</div>` : ''}
    </div>`;
  }

  /** Pip answers what was typed into the hub's box: a ready-made agent if one fits, else a custom one. */
  async function askPip(text) {
    const slot = $('#ask-reply');
    const id = matchIdea(text);
    const t = id && !id.startsWith('#') ? (S.templates || []).find((x) => x.id === id) : null;
    if (id === '#/watch') { go('#/watch'); return; }
    if (t && slot) {
      S.askText = text;
      slot.innerHTML = `<div class="pip-reply rise">${pip('happy', 64)}<div class="speech" style="flex:1"><p>I have just the thing: <strong>${esc(t.icon)} ${esc(t.name)}</strong>. ${esc(t.summary)}</p>
        <div class="row wrap" style="gap:8px;margin-top:10px"><a class="btn accent sm" href="#/t/${esc(t.id)}">Set it up</a><button class="btn ghost sm" data-act="ask-custom">Make my own instead</button></div></div></div>`;
      return;
    }
    await makeCustom(text);
  }
  async function makeCustom(text) {
    const slot = $('#ask-reply');
    if (slot) slot.innerHTML = `<div class="pip-reply rise">${pip('think', 64)}<div class="speech" style="flex:1"><p>On it! I'm getting a few experts to design it…</p></div></div>`;
    try {
      const a = await api('/api/agents', { method: 'POST', body: { idea: text } });
      S.agent = null; go(`#/a/${a.id}`);
    } catch (e) {
      if (slot) slot.innerHTML = `<div class="pip-reply rise">${pip('sleep', 64)}<div class="speech" style="flex:1"><p>${esc(e.message)}</p>${e.data?.upgrade ? '<a class="btn accent sm" style="margin-top:10px" href="#/me">See plans</a>' : ''}</div></div>`;
    }
  }

  // ===================== The simple app: Updates · Agents · New · You =====================
  const NAV_ON = {}; // no tab bar: the hub (#/) is where everything starts
  function bottomNav(active) {
    const items = [['home', '#/', 'Updates', icon.bell], ['agents', '#/agents', 'Agents', icon.grid], ['new', '#/new', 'New', icon.plus], ['me', '#/me', 'You', icon.me]];
    return `<nav class="nav" aria-label="Main">${items.map(([k, href, label, ic]) => `<a href="${href}" class="${active === k ? 'on' : ''}" ${active === k ? 'aria-current="page"' : ''}><span class="ni">${ic}${k === 'home' && S.unread ? `<b class="badge">${Math.min(S.unread, 99)}</b>` : ''}</span><span>${label}</span></a>`).join('')}</nav>`;
  }
  function setBadge() {
    const n = document.querySelector('.nav a[href="#/"] .ni');
    if (!n) return;
    n.querySelector('.badge')?.remove();
    if (S.unread) n.insertAdjacentHTML('beforeend', `<b class="badge">${Math.min(S.unread, 99)}</b>`);
  }

  /** An agent's state in plain words. */
  function plainStatus(a) {
    const ch = (a.package || a.release || {}).channel;
    if (a.status === 'running' || a.running) return { word: 'Working…', tone: 'accent' };
    if (a.status === 'error') return { word: 'Needs a look', tone: 'bad' };
    if (!ch) return { word: a.stage === 'brief' || a.stage === 'plan_review' ? 'Plan ready' : 'Being made', tone: 'accent' };
    if (ch === 'off') return { word: 'Paused', tone: '' };
    if ((a.missingSettings || []).length || (a.needsYou && /settings/.test(a.needsYou))) return { word: 'Needs answers', tone: 'warn' };
    if (ch === 'shadow') return { word: 'Testing', tone: 'accent' };
    return { word: 'On', tone: 'good' };
  }
  const statusChip = (a) => { const s = plainStatus(a); return `<span class="pill ${s.tone}">${s.tone === 'good' ? '<span class="dot"></span>' : ''}${s.word}</span>`; };
  /** When it runs, in plain words. */
  function whenText(triggers = []) {
    const parts = [];
    const order = { schedule: 0, interval: 1, message: 2, inbox: 3 };
    for (const t of [...triggers].sort((x, y) => (order[x.type] ?? 9) - (order[y.type] ?? 9))) {
      if (t.type === 'schedule') parts.push(`${t.days && t.days.length && t.days.length < 7 ? (t.days.length === 5 && !t.days.includes('sat') && !t.days.includes('sun') ? 'weekdays' : t.days.map((d) => d[0].toUpperCase() + d.slice(1)).join(', ')) : 'every day'} at ${t.at}`);
      if (t.type === 'interval') parts.push(`every ${t.minutes >= 60 ? (t.minutes === 60 ? 'hour' : `${t.minutes / 60} hours`) : `${t.minutes} minutes`}`);
      if (t.type === 'message') parts.push('when you message it');
      if (t.type === 'inbox') parts.push('when something arrives');
    }
    return parts.length ? parts.slice(0, 2).join(' · ') : 'when you tap Run';
  }
  const heldText = { testing: 'Testing: shown here only', snoozed: 'Snoozed', paused: 'You paused all agents', 'quiet hours': 'Quiet hours', 'in your daily digest': 'Saved for your daily digest' };
  const viaText = (v) => (!v ? '' : v === 'app only' ? 'Only here: notifications aren\'t on yet' : `Sent: ${v.split('+').map((x) => ({ push: 'phone', email: 'email', telegram: 'Telegram', phone: 'phone' }[x] || x)).join(' + ')}`);

  function updateCard(u) {
    return `<article class="glass card update rise" data-act="open-agent" data-id="${esc(u.agentId)}" data-uid="${esc(u.id)}">
      <div class="row" style="gap:12px;align-items:flex-start">
        <div class="avatar sm">${esc(u.icon || '✳︎')}</div>
        <div style="flex:1;min-width:0">
          <div class="row between" style="gap:8px"><span class="small" style="font-weight:600">${esc(u.agent || '')}</span><span class="tiny faint" style="flex:none">${ago(u.at)}</span></div>
          <div class="u-title">${esc(u.title)}</div>
          ${u.body ? `<div class="u-body">${esc(u.body)}</div>` : ''}
          ${u.link ? linkBtn(u.link) : ''}
          <div class="tiny faint" style="margin-top:6px">${u.held ? esc(heldText[u.held] || u.held) : esc(viaText(u.via))}</div>
        </div>
      </div></article>`;
  }

  function notifyCard(devices) {
    const granted = 'Notification' in window && Notification.permission === 'granted';
    if (granted && devices) return '';
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (ios && !standalone()) {
      return `<section class="glass card stack rise notify-card"><div class="row" style="gap:14px"><div class="avatar">🔔</div><div style="flex:1"><div class="h3">Get updates on your iPhone</div>
        <div class="small muted">iPhone only shows notifications for apps on the Home Screen. Add Pocket Box first, then open it from there.</div></div></div>
        <div class="row"><button class="btn accent sm" data-act="install">Add to Home Screen</button></div></section>`;
    }
    return `<section class="glass card stack rise notify-card"><div class="row" style="gap:14px"><div class="avatar">🔔</div><div style="flex:1"><div class="h3">Turn on notifications</div>
      <div class="small muted">So your agents can reach you on this ${ios ? 'iPhone' : 'device'}. You'll get a test right away.</div></div></div>
      <div class="row"><button class="btn accent sm" data-act="push-on">Turn on</button></div></section>`;
  }

  async function updatesView() {
    const [r] = await Promise.all([
      api('/api/updates').catch(() => ({ updates: [], unread: 0, devices: 0 })),
      api('/api/me/todo').then((x) => { S.todo = x.items; }).catch(() => { S.todo = []; }),
      api('/api/me/prefs').then((x) => { S.prefs = x.prefs; }).catch(() => {}),
    ]);
    S.updates = r.updates; S.unread = 0; S.pushDevices = r.devices;
    if (r.unread) api('/api/updates/seen', { method: 'POST' }).catch(() => {});
    const name = S.session.user?.firstName || '';
    const todo = (S.todo || []).filter((t) => !t.owner).slice(0, 3);
    return `<div class="shell">${topBar()}
      <section class="rise" style="padding:14px 0 16px"><div class="eyebrow">${esc(greeting())}${name ? `, ${esc(name)}` : ''}</div><h1 class="display" style="font-size:clamp(36px,10vw,52px);margin-top:6px">Updates</h1></section>
      ${pausedBanner()}
      ${notifyCard(r.devices)}
      ${todo.length ? `<section class="stack rise" style="margin-bottom:18px">${todo.map((t) => `<a class="glass card row todo-row" href="${esc(t.href || '#/me')}"><span style="flex:1;min-width:0"><span class="small" style="font-weight:600;display:block">${esc(t.title)}</span><span class="tiny muted">${esc(t.why)}</span></span><span class="btn accent sm" style="flex:none">${esc(t.action || 'Open')}</span></a>`).join('')}</section>` : ''}
      <div class="stack" id="updates">${r.updates.map(updateCard).join('')}</div>
      ${r.updates.length ? '' : `<section class="glass card stack rise empty-updates" style="text-align:center;padding:34px 22px">
        <div style="display:flex;justify-content:center">${pip('sleep', 110)}</div><div class="h3">Nothing yet</div>
        <p class="small muted" style="margin:0">When your agents have something to tell you, it shows up here and on your phone.</p>
        <div class="row" style="justify-content:center"><a class="btn accent" href="#/new">Add an agent</a></div></section>`}
    </div>`;
  }

  /** A new update arrived: banner at the top, and into the list if it's on screen. */
  function onUpdate(u) {
    if (!u) return;
    const r = route();
    const here = r.name === 'a' && r.id === u.agentId;
    if (r.name === 'updates' || (r.name === 'home' && $('#updates'))) {
      const list = $('#updates');
      if (list && !list.querySelector(`[data-uid="${u.id}"]`)) { list.insertAdjacentHTML('afterbegin', updateCard(u)); $('.empty-updates')?.remove(); }
      api('/api/updates/seen', { method: 'POST' }).catch(() => {});
    } else if (here) {
      appendConvo([{ kind: 'update', ...u }]);
    } else {
      S.unread = (S.unread || 0) + 1; setBadge();
    }
    if (!here) banner(u);
  }
  function banner(u) {
    const b = document.createElement('div');
    b.className = 'banner';
    b.innerHTML = `<div class="avatar sm">${esc(u.icon || '✳︎')}</div><div style="flex:1;min-width:0"><div class="tiny" style="font-weight:600;opacity:.75">${esc(u.agent || 'Pocket Box')}</div><div class="small" style="font-weight:600">${esc(u.title)}</div>${u.body ? `<div class="tiny" style="opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.body)}</div>` : ''}</div>`;
    b.addEventListener('click', () => { b.remove(); go(`#/a/${u.agentId}`); });
    document.body.append(b);
    requestAnimationFrame(() => b.classList.add('in'));
    setTimeout(() => { b.classList.remove('in'); setTimeout(() => b.remove(), 400); }, 6000);
  }

  async function agentsListView() {
    const list = await api('/api/agents');
    S.agents = list.agents;
    const row = (a) => {
      const line = a.needsYou && a.mine ? a.needsYou.replace(/:.*$/, '') : a.lastRun ? `${a.lastRun.ok ? '' : 'Failed · '}${a.lastRun.summary || 'Ran'} · ${ago(a.lastRun.at)}` : a.shared ? 'Shared with you' : 'Hasn\'t said anything yet';
      return `<a class="glass card row agent-row rise" href="#/a/${a.id}${a.mine && a.needsYou && /settings/.test(a.needsYou) ? '/settings' : ''}">
        <div class="avatar">${esc(a.icon || '✳︎')}</div>
        <div style="flex:1;min-width:0"><div class="h3" style="font-size:16.5px">${esc(a.title)}</div><div class="small muted ellipsis">${esc(line)}</div></div>
        ${statusChip(a)}</a>`;
    };
    return `<div class="shell">${topBar()}
      <section class="rise row between" style="padding:14px 0 16px;align-items:flex-end"><h1 class="display" style="font-size:clamp(36px,10vw,52px)">Agents</h1><a class="btn accent sm" href="#/new">${icon.plus.replace(/22/g, '16')} New</a></section>
      ${S.agents.length ? `<div class="stack">${S.agents.map(row).join('')}</div>` : `<section class="glass card stack" style="text-align:center;padding:34px 22px"><div style="display:flex;justify-content:center">${pip('hi', 110)}</div><div class="h3">No agents yet</div><p class="small muted" style="margin:0">Pick a ready-made one or describe your own. It takes a minute.</p><div class="row" style="justify-content:center"><a class="btn accent" href="#/new">Add an agent</a></div></section>`}
    </div>`;
  }

  async function newView() {
    await loadTemplates();
    const life = S.templates.filter((t) => t.tier === 'life');
    const quick = S.templates.filter((t) => t.tier !== 'life');
    const tile = (t) => `<a class="glass card row agent-row" href="#/t/${esc(t.id)}"><div class="avatar">${esc(t.icon)}</div><div style="flex:1;min-width:0"><div class="h3" style="font-size:16.5px">${esc(t.name)}</div><div class="small muted clamp2">${esc(t.summary)}</div></div><span class="faint">›</span></a>`;
    return `<div class="shell">${topBar()}
      <section class="rise" style="padding:14px 0 14px"><h1 class="display" style="font-size:clamp(36px,10vw,52px)">New agent</h1></section>
      <form data-form="new" class="composer glass rise">
        <textarea name="idea" data-grow rows="3" placeholder="Describe what you want it to do, like you'd ask a friend…" required></textarea>
        <div class="bar"><span class="small faint">We design, build and test it for you.</span><span class="spacer"></span>${micButton()}<button class="send" aria-label="Create" disabled>${icon.send}</button></div>
      </form>
      <div class="eyebrow" style="margin:30px 4px 12px">Or start with one of these</div>
      <div class="stack rise">${life.map(tile).join('')}</div>
      ${quick.length ? `<details class="glass card" style="margin-top:14px"><summary class="h3" style="cursor:pointer;font-size:16px">Simple alerts (${quick.length})</summary>
        <div class="stack" style="margin-top:12px">${quick.map(tile).join('')}</div></details>` : ''}
    </div>`;
  }

  // ---- one agent: a conversation, and a Customize sheet ----
  async function agentPage(id, sub) {
    if (['advanced', 'runs', 'code', 'thread'].includes(sub)) return agentView(id, sub === 'advanced' ? 'settings' : sub);
    const a = await api(`/api/agents/${id}`);
    if (!a.package) return agentView(id);
    S.agent = a; S.firstOpen = null; S.runs = null; S.files = null;
    const talks = !!(a.talk && a.talk.message);
    S.tab = talks ? 'chat' : 'thread';
    S.chat = a.talk && (a.talk.message || a.talk.inbox) ? (await api(`/api/agents/${id}/chat`).catch(() => ({ entries: [] }))).entries : [];
    if (sub === 'settings') setTimeout(() => openCustomize(), 350);
    const mine = a.ownerId === S.session.user.id;
    const ch = a.package.channel;
    const items = convoItems(a);
    return `<div class="shell has-dock">
      <header class="top"><button class="btn ghost icon" data-act="back" aria-label="Back">${icon.back}</button><span class="spacer"></span>${mine ? '<button class="btn soft sm" data-act="customize">Customize</button>' : ''}</header>
      <section class="rise" style="padding:4px 0 14px"><div class="row" style="gap:14px">
        <div class="avatar lg">${esc(a.icon || '✳︎')}</div>
        <div style="min-width:0"><h1 class="h2" style="font-size:24px;line-height:1.15">${esc(a.title)}</h1>
          <div class="row wrap" style="gap:8px;margin-top:6px">${statusChip(a)}<span class="small muted">Runs ${esc(whenText(a.package.triggers))}</span></div></div></div></section>
      ${mine && (a.missingSettings || []).length ? `<section class="glass card stack rise attn"><div class="h3">Answer ${a.missingSettings.length === 1 ? '1 question' : `${a.missingSettings.length} questions`} to start it</div><p class="small muted" style="margin:0">${esc(a.missingSettings.join(', '))}</p><div class="row"><button class="btn accent sm" data-act="customize">Answer now</button></div></section>` : ''}
      ${mine && ch === 'shadow' && !(a.missingSettings || []).length ? `<section class="glass card stack rise attn"><div class="h3">It's in testing</div><p class="small muted" style="margin:0">It runs and shows what it would say here, but doesn't notify you yet.</p><div class="row"><button class="btn accent sm" data-act="power" data-on="1">Turn it on</button></div></section>` : ''}
      ${mine && ch === 'off' ? `<section class="glass card stack rise attn"><div class="h3">It's paused</div><div class="row"><button class="btn accent sm" data-act="power" data-on="1">Turn it back on</button></div></section>` : ''}
      <div class="chat" id="chat">${items.map(convoHtml).join('')}</div>
      <div id="chat-typing" class="chat-row agent" hidden><div class="avatar sm">${esc(a.icon || '✳︎')}</div><div class="bubble agent"><span class="dots"><i></i><i></i><i></i></span></div></div>
      ${items.length ? '' : `<p class="small muted empty-convo" style="text-align:center;margin:26px 0">${talks ? `Say hi, or try one of the suggestions below.` : `Nothing yet. It runs ${esc(whenText(a.package.triggers))}; you can also run it now.`}</p>`}
    </div>
    <div class="dock"><div class="dock-inner">
      <div class="row chips-scroll" style="gap:8px;margin-bottom:10px">
        ${ch !== 'off' && !(a.missingSettings || []).length ? '<button class="chip" data-act="run-now">▶ Run now</button>' : ''}
        ${talks ? (a.talk.examples || []).slice(0, 6).map((x) => `<button class="chip" data-act="say" data-text="${esc(x)}">${esc(x)}</button>`).join('') : ''}
      </div>
      ${talks ? `<form data-form="chat" class="composer glass slim"><textarea name="text" data-grow rows="1" placeholder="Message ${esc(a.title)}…"></textarea><div class="bar"><span class="spacer"></span>${micButton()}<button class="send" aria-label="Send" disabled>${icon.send}</button></div></form>`
        : mine ? `<form data-form="message" class="composer glass slim"><textarea name="text" data-grow rows="1" placeholder="Ask for a change, e.g. only on weekdays…"></textarea><div class="bar"><span class="spacer"></span>${micButton()}<button class="send" aria-label="Send" disabled>${icon.send}</button></div></form>` : ''}
    </div></div>`;
  }

  /** Everything in an agent's conversation, oldest first: its updates, chat, and changes you asked for. */
  function convoItems(a) {
    const rel = a.package?.publishedAt || 0;
    const firstRel = (a.package?.history || []).reduce((m, h) => Math.min(m, h.publishedAt || m), rel) || rel;
    const crew = (a.messages || []).filter((m) => m.ts >= firstRel && (m.kind === 'owner' || m.agentId === 'system' || m.kind === 'answer')).map((m) => ({ kind: 'crew', id: m.id, at: m.ts, mine: m.kind === 'owner', text: m.kind === 'owner' ? m.content : (m.summary || m.content) }));
    const ups = (a.updates || []).map((u) => ({ kind: 'update', ...u }));
    const chats = (S.chat || []).map((e) => ({ kind: 'chat', ...e }));
    return [...ups, ...chats, ...crew].sort((x, y) => x.at - y.at).slice(-150);
  }
  function convoHtml(x) {
    const a = S.agent;
    const time = new Date(x.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    if (x.kind === 'chat') return chatEntry(x, a);
    if (x.kind === 'crew') return x.mine
      ? `<div class="chat-row you" data-id="${esc(x.id)}"><div class="bubble you">${esc(x.text)}</div><div class="tiny faint">Change request · ${time}</div></div>`
      : `<div class="chat-row agent" data-id="${esc(x.id)}"><div class="avatar sm">📦</div><div style="min-width:0"><div class="bubble agent">${esc(x.text)}</div><div class="tiny faint">Pocket Box · ${time}</div></div></div>`;
    return `<div class="chat-row agent" data-id="${esc(x.id)}"><div class="avatar sm">${esc(a.icon || '✳︎')}</div><div style="min-width:0"><div class="bubble agent"><strong>${esc(x.title)}</strong>${x.body ? `\n${esc(x.body)}` : ''}</div>${linkBtn(x.link)}<div class="tiny faint">${time} · ${x.held ? esc(heldText[x.held] || x.held) : esc(viaText(x.via))}</div></div></div>`;
  }
  function appendConvo(items) {
    const list = $('#chat');
    if (!list) return;
    for (const x of items) { if (!list.querySelector(`[data-id="${x.id}"]`)) list.insertAdjacentHTML('beforeend', convoHtml(x)); }
    $('.empty-convo')?.remove();
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function openCustomize() {
    const a = S.agent;
    if (!a || !a.package) return;
    const ch = a.package.channel;
    const style = a.notifyStyle || 'normal';
    const sched = (a.package.triggers || []).some((t) => t.type === 'schedule' || t.type === 'interval');
    const close = sheet(`<form class="stack customize">
      <div class="row between"><div class="h3">Customize ${esc(a.title)}</div><button type="button" class="btn ghost sm" data-close>Done</button></div>
      <div class="cz-row"><div><div class="cz-t">It's ${ch === 'off' ? 'paused' : ch === 'shadow' ? 'testing' : 'on'}</div><div class="tiny muted">${ch === 'live' ? 'Running and notifying you.' : ch === 'shadow' ? 'Running, shown here only.' : 'Not running.'}</div></div>
        ${ch === 'live' ? '<button type="button" class="btn soft sm" data-act="power" data-on="0">Pause</button>' : '<button type="button" class="btn accent sm" data-act="power" data-on="1">Turn on</button>'}</div>
      ${a.settings.length ? `<div class="cz-sec">Its answers</div>${a.settings.map(settingField(true)).join('')}<div class="row"><button class="btn accent sm">Save answers</button></div>` : ''}
      <div class="cz-sec">When it runs</div>
      <div class="cz-row"><div class="small">${esc(whenText(a.package.triggers))}</div>${sched ? '<button type="button" class="btn soft sm" data-act="edit-when">Change</button>' : ''}</div>
      <div class="cz-sec">How it tells you</div>
      <div class="row wrap" style="gap:8px">${[['normal', '🔔 Notify me'], ['quiet', '🔕 Quietly'], ['urgent', '🚨 Urgent'], ['digest', '🗞 Daily digest']].map(([k, l]) => `<button type="button" class="chip ${style === k ? 'on' : ''}" data-act="cz-style" data-style="${k}">${l}</button>`).join('')}</div>
      <div class="row wrap" style="gap:8px">${a.snoozeUntil && a.snoozeUntil > Date.now() ? `<span class="small muted">Snoozed until ${new Date(a.snoozeUntil).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span><button type="button" class="chip" data-act="snooze" data-until="off">Unsnooze</button>` : '<button type="button" class="chip" data-act="snooze" data-minutes="60">Snooze 1 hour</button><button type="button" class="chip" data-act="snooze" data-until="today">Quiet for today</button>'}</div>
      <div class="cz-sec">More</div>
      <div class="row wrap" style="gap:8px"><a class="btn soft sm" href="#/a/${a.id}/advanced">Sharing, runs and advanced</a><button type="button" class="btn danger sm" data-act="cz-delete">Delete</button></div>
    </form>`, async (fd) => {
      const values = {};
      for (const st of a.settings) { const v = fd.get(st.key); if (st.type === 'secret' && !v) continue; values[st.key] = v; }
      const r = await api(`/api/agents/${a.id}/settings`, { method: 'POST', body: { values } });
      toast(r.missing.length ? `Saved. Still needed: ${r.missing.join(', ')}.` : 'Saved. It can run now.');
      render({ transition: false });
    });
    S.closeCustomize = close;
    for (const ta of document.querySelectorAll('.customize textarea[data-grow]')) grow(ta);
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
  document.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-plan-for]');
    if (!sel) return;
    try { await api(`/api/admin/users/${sel.dataset.planFor}/plan`, { method: 'POST', body: { plan: sel.value } }); toast(`Plan set to ${sel.value}.`); } catch (err) { toast(err.message, 'bad'); }
  });
  document.addEventListener('input', (e) => {
    const ta = e.target.closest('textarea[data-grow]');
    if (ta) grow(ta);
    const form = e.target.closest('form[data-form="new"], form[data-form="message"], form[data-form="chat"], form[data-form="ask"]');
    if (form) form.querySelector('.send').disabled = !form.querySelector('textarea').value.trim();
  });

  document.addEventListener('keydown', (e) => {
    const ta = e.target.closest('form[data-form="new"] textarea, form[data-form="message"] textarea, form[data-form="chat"] textarea, form[data-form="ask"] textarea');
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
        if (/^\/#\/s\/[A-Za-z0-9_-]+$/.test(next || '')) { location.href = next; return; }
        go(afterSignIn());
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
        go(afterSignIn());
      } else if (kind === 'new') {
        const a = await api('/api/agents', { method: 'POST', body: { idea: data.idea, template: store.get('pb.template', null) } });
        store.set('pb.template', null);
        S.agent = null;
        go(`#/a/${a.id}`);
      } else if (kind === 'ask') {
        const text = String(data.text || '').trim();
        if (!text) return;
        await askPip(text);
      } else if (kind === 'chat') {
        const ta = form.querySelector('textarea');
        const text = String(data.text || '').trim();
        if (!text) return;
        ta.value = ''; grow(ta); form.querySelector('.send').disabled = true;
        if (S.tab !== 'chat') { S.tab = 'chat'; await render({ transition: false }); }
        await sayToAgent(text);
      } else if (kind === 'message') {
        const text = String(data.text || '').trim();
        if (!text) return;
        const ta = form.querySelector('textarea');
        ta.value = ''; grow(ta); form.querySelector('.send').disabled = true;
        const msg = await api(`/api/agents/${S.agent.id}/message`, { method: 'POST', body: { text } });
        if (!$('#thread') && $('#chat')) { appendConvo([{ kind: 'crew', id: msg.id, at: msg.ts, mine: true, text }]); toast('Got it. Pocket Box is making that change.'); }
        else if (!S.agent.messages.some((x) => x.id === msg.id)) {
          S.agent.messages.push(msg);
          if (S.tab !== 'thread') { S.tab = 'thread'; render({ transition: false }); }
          else { $('#thread')?.insertAdjacentHTML('beforeend', msgView(msg, true)); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }
        }
      } else if (kind === 'settings') {
        const values = {};
        for (const s of S.agent.settings) { const v = data[s.key]; if (s.type === 'secret' && !v) continue; values[s.key] = v; }
        const r = await api(`/api/agents/${S.agent.id}/settings`, { method: 'POST', body: { values } });
        S.agent.settings = r.settings; S.agent.missingSettings = r.missing;
        toast(r.missing.length ? `Saved. Still needed: ${r.missing.join(', ')}.` : 'All set. It can run now.');
        render({ transition: false });
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
        const live = form.querySelector('[name="live"]') ? !!data.live : true;
        const a = await api(`/api/templates/${id}/install`, { method: 'POST', body: { values, when, live, runsOn } });
        toast(`${a.title} is on. ${a.runsOn === 'cloud' ? 'It runs in the cloud.' : 'Open the Runtime on your phone to start it.'}`);
        S.agent = null; go(`#/a/${a.id}`);
      } else if (kind === 'share-install') {
        const runsOn = form.querySelector('[data-runs] .on')?.dataset.runsOn || 'cloud';
        const a = await api(`/api/shares/${encodeURIComponent(form.dataset.code)}/install`, { method: 'POST', body: { live: !!data.live, runsOn } });
        toast(`${a.title} is yours.${(a.missingSettings || []).length ? ' Add its settings to start it.' : ''}`);
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
      } else if (kind === 'share') {
        S.agent = await api(`/api/agents/${S.agent.id}/members`, { method: 'POST', body: { email: data.email } });
        const b = $('#tab-body'); if (b) b.innerHTML = settingsTab(S.agent);
        toast('Shared. They\'ve been emailed.');
      } else if (kind === 'prefs') {
        const r = await api('/api/me/prefs', { method: 'POST', body: { emailAgents: !!data.emailAgents, quietFrom: data.quietFrom || null, quietTo: data.quietTo || null, digestAt: data.digestAt || '18:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone } });
        S.prefs = r.prefs; toast('Saved.');
      } else if (kind === 'about') {
        await api('/api/me/about', { method: 'POST', body: data });
        toast('Saved.');
      } else if (kind === 'password') {
        await api('/api/password', { method: 'POST', body: data });
        form.reset(); toast('Password changed. Other devices were signed out.');
      }
    } catch (err) {
      // Signed up but never opened the email: offer to send it again, right here.
      if (kind === 'login' && err.status === 403 && /link we emailed/.test(err.message) && note) {
        note.innerHTML = `<div class="note pop">You haven't finished setting up yet: open the link we emailed you (check Spam and Promotions too).<div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-act="resend-signup" data-email="${esc(data.email || '')}">Send the link again</button></div></div>`;
      } else say(err.message);
    } finally { if (document.contains(btn)) busy(btn, false); }
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
      case 'to-thread':
      case 'tab':
        S.tab = act === 'to-thread' ? 'thread' : el.dataset.tab;
        document.body.dataset.tab = S.tab;
        for (const t of document.querySelectorAll('.tab')) { t.classList.toggle('on', t.dataset.tab === S.tab); t.setAttribute('aria-selected', t.dataset.tab === S.tab); }
        { const b = $('#tab-body'); if (b) { b.innerHTML = tabBody(a); b.classList.remove('rise'); void b.offsetWidth; b.classList.add('rise'); for (const ta of b.querySelectorAll('textarea[data-grow]')) grow(ta); } }
        if (S.tab === 'settings') $('#values')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (S.tab === 'runs') loadRuns();
        if (S.tab === 'chat') loadChat().then(() => { const b = $('#tab-body'); if (b && S.tab === 'chat') { b.innerHTML = chatTab(S.agent); window.scrollTo({ top: document.body.scrollHeight }); } });
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
          ${a.package && a.role !== 'member' ? '<button class="btn soft" style="width:100%" data-sheet="share">Share a copy</button><a class="btn soft" style="width:100%" href="/runtime">Open the Runtime</a>' : ''}
          ${a.role === 'member' ? '<button class="btn danger" style="width:100%" data-sheet="leave">Leave this shared agent</button>' : '<button class="btn danger" style="width:100%" data-sheet="delete">Delete agent</button>'}
          <button class="btn ghost" style="width:100%" data-close>Close</button></div>`);
        const root = $('.scrim:last-of-type');
        root.addEventListener('click', async (ev) => {
          const s = ev.target.closest('[data-sheet]');
          if (!s) return;
          if (s.dataset.sheet === 'share') {
            close();
            let r;
            try { r = await api(`/api/agents/${a.id}/share`, { method: 'POST' }); } catch (err) { toast(err.message, 'bad'); return; }
            S.agent.shareCode = r.code;
            const done = sheet(`<div class="stack"><div class="h3">Share a copy of ${esc(a.title)}</div>
              <p class="small muted" style="margin:0">Anyone with this link can make their own copy: its code and checks, never your settings, memory or runs. Your changes later don't reach their copy.</p>
              <input class="input" readonly value="${esc(r.url)}" data-share-url>
              <div class="row wrap" style="gap:8px"><button class="btn accent sm" data-share="copy">Copy link</button>${navigator.share ? '<button class="btn soft sm" data-share="send">Send…</button>' : ''}<button class="btn ghost sm" data-share="stop">Stop sharing</button></div>
              <button class="btn ghost" style="width:100%" data-close>Done</button></div>`);
            $('[data-share-url]').closest('.scrim').addEventListener('click', async (ev2) => {
              const b = ev2.target.closest('[data-share]');
              if (!b) return;
              if (b.dataset.share === 'copy') { try { await navigator.clipboard.writeText(r.url); toast('Link copied.'); } catch { $('[data-share-url]').select(); } }
              if (b.dataset.share === 'send') navigator.share({ title: a.title, text: `Try my Pocket Box agent "${a.title}"`, url: r.url }).catch(() => {});
              if (b.dataset.share === 'stop') { try { await api(`/api/agents/${a.id}/share`, { method: 'DELETE' }); S.agent.shareCode = null; toast('That link no longer works.'); done(); } catch (err) { toast(err.message, 'bad'); } }
            });
          } else if (s.dataset.sheet === 'rename') {
            const t = prompt('Name', a.title);
            if (t && t.trim()) { S.agent = await api(`/api/agents/${a.id}`, { method: 'PATCH', body: { title: t.trim() } }).catch((err) => { toast(err.message, 'bad'); return S.agent; }); patchAgent(); close(); }
          } else if (s.dataset.sheet === 'leave') {
            if (!confirm(`Stop getting ${a.title}'s notifications?`)) return;
            try { await api(`/api/agents/${a.id}/members/${S.session.user.id}`, { method: 'DELETE' }); close(); S.agent = null; go('#/'); } catch (err) { toast(err.message, 'bad'); }
          } else if (s.dataset.sheet === 'delete') {
            if (!confirm(`Delete ${a.title}? Your phones stop running it.`)) return;
            try { await api(`/api/agents/${a.id}`, { method: 'DELETE' }); close(); S.agent = null; go('#/'); } catch (err) { toast(err.message, 'bad'); }
          }
        });
        break;
      }
      case 'install': await install(); break;
      case 'style': { const r = await post(`/api/agents/${a.id}/style`, { style: el.dataset.style }); if (r) { S.agent = r; const b = $('#tab-body'); if (b) b.innerHTML = settingsTab(r); } break; }
      case 'unshare': { try { S.agent = await api(`/api/agents/${a.id}/members/${el.dataset.user}`, { method: 'DELETE' }); const b = $('#tab-body'); if (b) b.innerHTML = settingsTab(S.agent); } catch (err) { toast(err.message, 'bad'); } break; }
      case 'uninvite': { try { S.agent = await api(`/api/agents/${a.id}/invites?email=${encodeURIComponent(el.dataset.email)}`, { method: 'DELETE' }); const b = $('#tab-body'); if (b) b.innerHTML = settingsTab(S.agent); } catch (err) { toast(err.message, 'bad'); } break; }
      case 'upgrade': { const r = await post('/api/billing/checkout', { plan: el.dataset.plan }); if (r && r.url) location.href = r.url; break; }
      case 'todo-steps': {
        const t = (S.todo || []).find((x) => x.id === el.dataset.id);
        if (!t) break;
        sheet(`<div class="stack"><div class="h3">${esc(t.title)}</div><p class="small muted" style="margin:0">${esc(t.why)}</p>
          <ol class="stack small" style="margin:0;padding-left:20px;gap:10px">${t.steps.map((x) => `<li>${linkify(x)}</li>`).join('')}</ol>
          <p class="tiny faint" style="margin:0">Never paste keys into a chat; GitHub secrets keep them off the screen and out of the code.</p>
          <button class="btn ghost" style="width:100%" data-close>Done</button></div>`);
        break;
      }
      case 'say': await sayToAgent(el.dataset.text); break;
      case 'back': {
        S.trail = S.trail || [];
        S.trail.pop();
        const prev = S.trail.pop();
        go(prev && prev !== location.hash ? prev : '#/');
        break;
      }
      case 'resend-signup': {
        try { await api('/api/forgot', { method: 'POST', body: { email: el.dataset.email } }); el.closest('.note').innerHTML = 'Sent. It comes from Pocket Box; look in Spam and Promotions if it isn\'t in your inbox in a minute.'; } catch (err) { toast(err.message, 'bad'); }
        break;
      }
      case 'copy-setlink': { const v = $('[data-setlink]')?.value || ''; try { await navigator.clipboard.writeText(v); toast('Link copied.'); } catch { $('[data-setlink]')?.select(); } break; }
      case 'ask-custom': await makeCustom(S.askText || ''); break;
      case 'open-agent': if (!e.target.closest('a')) go(`#/a/${el.dataset.id}`); break;
      case 'customize': openCustomize(); break;
      case 'push-on': await enablePush(el, { test: true }); render({ transition: false }); break;
      case 'push-test': { const r = await post('/api/push/test'); if (r) toast(r.sent ? 'Sent. It should appear in a few seconds.' : r.devices ? 'Your devices didn\'t accept it. Turn notifications on again.' : 'No device has notifications on yet. Tap Turn on first.', r.sent ? '' : 'bad'); break; }
      case 'power': {
        const on = el.dataset.on === '1';
        const r = await post(`/api/agents/${a.id}/channel`, { channel: on ? 'live' : 'off' });
        if (r) { toast(on ? `${a.title} is on.` : `${a.title} is paused.`); S.closeCustomize?.(); render({ transition: false }); }
        break;
      }
      case 'cz-style': {
        const r = await post(`/api/agents/${a.id}/style`, { style: el.dataset.style });
        if (r) { S.agent.notifyStyle = el.dataset.style; for (const c of document.querySelectorAll('[data-act="cz-style"]')) c.classList.toggle('on', c === el); toast({ normal: 'It will notify you normally.', quiet: 'It will arrive without sound.', urgent: 'It will stay on screen and get through quiet hours.', digest: 'Collected into your daily digest.' }[el.dataset.style]); }
        break;
      }
      case 'cz-delete':
        if (!confirm(`Delete ${a.title}? This can't be undone.`)) break;
        try { await api(`/api/agents/${a.id}`, { method: 'DELETE' }); S.closeCustomize?.(); S.agent = null; toast('Deleted.'); go('#/agents'); } catch (err) { toast(err.message, 'bad'); }
        break;
      case 'run-now': {
        if (a.inputs && a.inputs.length) { askRunInputs(a); break; }
        const r = await post(`/api/agents/${a.id}/run`, {});
        if (r && r.run) { if (!r.run.ok) toast(`It didn't work: ${r.run.error || 'unknown error'}`, 'bad'); else if (!r.run.notifications.length) toast('It ran: nothing to tell you right now.'); }
        break;
      }
      case 'inbox-copy': { const v = $('[data-inbox-url]')?.value || ''; try { await navigator.clipboard.writeText(v); toast('Address copied.'); } catch { $('[data-inbox-url]')?.select(); } break; }
      case 'inbox-rotate': {
        if (!confirm('Make a new address? The old one stops working, so update your Shortcuts.')) break;
        const r = await post(`/api/agents/${a.id}/inbox-rotate`);
        if (r) { S.agent.inboxUrl = r.url; const b = $('#tab-body'); if (b) b.innerHTML = settingsTab(S.agent); toast('New address ready.'); }
        break;
      }
      case 'inbox-help':
        sheet(`<div class="stack"><div class="h3">Send things to ${esc(a.title)} automatically</div>
          <div class="small" style="font-weight:600">iPhone: every Apple Pay purchase</div>
          <ol class="small stack" style="margin:0;padding-left:20px;gap:6px">
            <li>Open <strong>Shortcuts</strong> → <strong>Automation</strong> → <strong>+</strong> → <strong>Transaction</strong>. Pick your cards, choose <strong>Run Immediately</strong>, tap Next.</li>
            <li>Tap <strong>New Blank Automation</strong> → add the action <strong>Get Contents of URL</strong>.</li>
            <li>URL: paste the address. Tap the arrow to show more: Method <strong>POST</strong>, Request Body <strong>Form</strong>, add a text field named <strong>text</strong> with: <em>Merchant</em> <em>Amount</em> <em>Card</em> (tap each to insert it from the transaction).</li>
          </ol>
          <div class="small" style="font-weight:600">iPhone: your bank's texts</div>
          <ol class="small stack" style="margin:0;padding-left:20px;gap:6px">
            <li>Shortcuts → Automation → + → <strong>Message</strong>. Sender: your bank (or Message Contains "debited"/"charged"). Run Immediately.</li>
            <li>Add <strong>Get Contents of URL</strong> the same way, with the field <strong>text</strong> = <em>Shortcut Input</em> (the message).</li>
          </ol>
          <div class="small" style="font-weight:600">Android</div>
          <p class="small muted" style="margin:0">Use an automation app (MacroDroid, Tasker, or "HTTP Shortcuts"): when an SMS from your bank arrives, send an HTTP POST to the address with the message as the body.</p>
          <div class="small" style="font-weight:600">Email</div>
          <p class="small muted" style="margin:0">With Zapier or IFTTT: "new email matching…" → "Webhooks: POST" to the address, body = the email text.</p>
          <p class="tiny faint" style="margin:0">Test it: send anything to the address; it shows up in the Chat tab within seconds.</p>
          <button class="btn ghost" style="width:100%" data-close>Done</button></div>`);
        break;
      case 'pause-all': {
        const f = el.dataset.for;
        let until = null;
        if (f === '60') until = Date.now() + 3600000;
        if (f === 'week') until = Date.now() + 7 * 86400000;
        if (f === 'morning') { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); until = d.getTime(); }
        const r = await post('/api/me/prefs', { pauseUntil: until });
        if (r) { S.prefs = r.prefs; toast(until ? `Paused until ${pauseWhen(until)}.` : 'Agents can reach you again.'); render({ transition: false }); }
        break;
      }
      case 'tg-on': { const r = await post('/api/me/telegram'); if (r && r.url) { window.open(r.url, '_blank', 'noopener'); toast('Tap Start in Telegram, then come back.'); } break; }
      case 'tg-off': { try { await api('/api/me/telegram', { method: 'DELETE' }); toast('Telegram disconnected.'); render({ transition: false }); } catch (err) { toast(err.message, 'bad'); } break; }
      case 'billing-portal': { const r = await post('/api/billing/portal'); if (r && r.url) location.href = r.url; break; }
      case 'delete-account':
        sheet(`<form class="stack"><div class="h3">Delete your account?</div><p class="small muted" style="margin:0">This removes your account and all your agents, their settings and runs, and unpairs your phones. It can't be undone.</p>
          <label class="field"><span>Your password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
          <div class="row" style="justify-content:flex-end"><button type="button" class="btn ghost sm" data-close>Keep it</button><button class="btn danger sm">Delete everything</button></div></form>`,
        async (fd) => { await api('/api/me/delete', { method: 'POST', body: { password: fd.get('password') } }); S.session = { authed: false }; S.es?.close(); S.es = null; toast('Your account was deleted.'); go('#/login'); });
        break;
      case 'set-plan': { const r = await post(`/api/admin/users/${el.dataset.id}/plan`, { plan: el.value }); if (r) toast('Plan changed.'); break; }
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
          if (r.link) {
            const msg = `Here's your link to set up Pocket Box (works once, for 24 hours): ${r.link}`;
            sheet(`<div class="stack"><div class="h3">${r.emailed ? 'Emailed. Want to send it yourself too?' : 'The email didn\'t go out'}</div>
              <p class="small muted" style="margin:0">${r.emailed ? 'If it\'s not in their inbox (check Spam and Promotions), send them this one-time link. It works once, for 24 hours.' : 'Send them this one-time link yourself. It works once, for 24 hours.'}</p>
              <input class="input mono" readonly value="${esc(r.link)}" data-setlink>
              <div class="row wrap" style="gap:8px"><button class="btn accent sm" data-act="copy-setlink">Copy link</button><a class="btn soft sm" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Send on WhatsApp</a><a class="btn soft sm" href="sms:?&body=${encodeURIComponent(msg)}">Text it</a></div>
              <button class="btn ghost" style="width:100%" data-close>Done</button></div>`);
          }
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

  async function enablePush(btn, { test = false } = {}) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('This browser cannot receive notifications. On iPhone, add Pocket Box to your Home Screen first.', 'bad');
    busy(btn, true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') throw new Error('Notifications were not allowed.');
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await api('/api/push/key');
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
      if (test) { const r = await api('/api/push/test', { method: 'POST' }).catch(() => ({ sent: 0 })); toast(r.sent ? 'Notifications are on. A test is on its way.' : 'Notifications are on, but the test didn\'t arrive. Try again in a minute.', r.sent ? '' : 'bad'); }
      else toast('Notifications are on for this device.');
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
  if (new URLSearchParams(location.search).has('paid')) { setTimeout(() => toast('Thank you! Your plan updates in a moment.'), 800); history.replaceState(null, '', `/${location.hash}`); }
})();
