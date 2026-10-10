// Pocket Box Runtime: runs the owner's signed agents on this phone.
//
// - Pairs once with the Studio and pins its signing key.
// - Downloads packages and refuses any whose Ed25519 signature does not verify.
// - Runs each agent in its own network-less worker; every ctx call comes back
//   here and is checked against the signed manifest before it happens.
// - Shadow mode records what an agent would have said; live mode says it.
// - Reports every run to the Studio (queued while offline).
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const K = { pair: 'pb.rt.pair', state: 'pb.rt.state', feed: 'pb.rt.feed', last: 'pb.rt.last', outbox: 'pb.rt.outbox', mem: (id) => `pb.rt.mem.${id}` };
  const RUN_TIMEOUT_MS = 90 * 1000;
  const OPEN_EVERY_MS = 10 * 60 * 1000;
  const LATE_WINDOW_MS = 3 * 3600 * 1000;

  const R = { pair: ls.get(K.pair, null), state: ls.get(K.state, null), verified: {}, running: new Set(), tab: 'agents', session: null, problem: null, offline: false };

  function toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    $('#toasts').append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, kind === 'bad' ? 5200 : 3400);
  }
  function ago(ts) {
    if (!ts) return 'never';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const when = (d) => d ? d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  function b64u(s) { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((String(s) + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); }
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    return JSON.stringify(v);
  }
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

  // ---- talking to the Studio ---------------------------------------------------
  async function device(path, body) {
    const res = await fetch(`/api/device/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${R.pair.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.unpaired) { unpairLocal('This phone was removed from your Studio. Pair it again.'); throw new Error(data.error); }
    if (!res.ok) throw Object.assign(new Error(data.error || `The Studio said ${res.status}.`), { status: res.status, data });
    return data;
  }
  function unpairLocal(why) {
    ls.del(K.pair); ls.del(K.state);
    R.pair = null; R.state = null; R.verified = {};
    if (why) R.problem = why;
    render();
  }

  // ---- signatures -------------------------------------------------------------------
  let edOk = null;
  async function edSupported() {
    if (edOk !== null) return edOk;
    try { await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'Ed25519' }, false, ['verify']); edOk = true; } catch { edOk = false; }
    return edOk;
  }
  async function verifyAll(state) {
    const out = {};
    if (!(await edSupported())) return { _unsupported: true };
    const key = await crypto.subtle.importKey('raw', b64u(R.pair.publicKey), { name: 'Ed25519' }, false, ['verify']);
    for (const a of state.agents) {
      if (!a.package || !a.signature) continue;
      try {
        out[a.agentId] = a.package.agentId === a.agentId
          && await crypto.subtle.verify({ name: 'Ed25519' }, key, b64u(a.signature), new TextEncoder().encode(canonical(a.package)));
      } catch { out[a.agentId] = false; }
    }
    return out;
  }

  async function sync({ quiet = false } = {}) {
    if (!R.pair) return;
    try {
      const st = await device('state');
      if (st.publicKey !== R.pair.publicKey) {
        R.problem = 'Your Studio\'s signing key changed since this phone was paired, so nothing will run. If you expected this, remove the phone in the Studio and pair it again.';
        render();
        return;
      }
      R.state = st; R.offline = false;
      ls.set(K.state, st);
    } catch (e) {
      if (!R.pair) return;
      R.offline = true;
      if (!quiet && !R.state) R.problem = e.message;
    }
    if (R.state) R.verified = await verifyAll(R.state);
    flushOutbox();
    render();
  }

  // ---- triggers ------------------------------------------------------------------------
  const lastRuns = () => ls.get(K.last, {});
  function markRun(agentId, kind) { const l = lastRuns(); l[agentId] = { ...(l[agentId] || {}), [kind]: Date.now(), any: Date.now() }; ls.set(K.last, l); }
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  /** The most recent time this schedule was due, if within the late window. */
  function lastDue(t, now = new Date()) {
    const [h, m] = String(t.at).split(':').map(Number);
    for (let i = 0; i < 2; i++) {
      const c = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, h, m, 0, 0);
      if (c > now) continue;
      if (t.days && t.days.length && !t.days.includes(DAYS[c.getDay()])) continue;
      return now - c <= LATE_WINDOW_MS ? c : null;
    }
    return null;
  }
  function nextDue(a) {
    const l = lastRuns()[a.agentId] || {};
    const times = (a.package?.manifest.triggers || []).map((t) => {
      if (t.type === 'schedule' && self.PocketCore) return self.PocketCore.nextDue(t, new Date());
      if (t.type === 'interval') return new Date((l.interval || Date.now()) + t.minutes * 60000);
      return null;
    }).filter(Boolean).sort((x, y) => x - y);
    return times[0] || null;
  }

  function runnable(a) {
    return a.package && a.channel !== 'off' && R.verified[a.agentId] === true && !(a.missingSettings || []).length;
  }

  /** Which trigger (if any) makes this agent due now. */
  function dueTrigger(a, { opened = false } = {}) {
    const l = lastRuns()[a.agentId] || {};
    for (const t of a.package.manifest.triggers || []) {
      if (t.type === 'schedule') {
        const d = lastDue(t);
        if (d && (l.schedule || 0) < d.getTime()) return { type: 'schedule', at: t.at, late: Date.now() - d.getTime() > 5 * 60000, dueAt: d.toISOString() };
      }
      if (t.type === 'interval' && Date.now() - (l.interval || 0) >= t.minutes * 60000) return { type: 'interval', minutes: t.minutes };
      if (t.type === 'open' && opened && Date.now() - (l.open || 0) >= OPEN_EVERY_MS) return { type: 'open' };
    }
    return null;
  }

  let checking = false;
  async function checkDue(opts = {}) {
    if (checking || !R.state) return;
    checking = true;
    try {
      for (const a of R.state.agents) {
        if (!runnable(a) || R.running.has(a.agentId)) continue;
        const t = dueTrigger(a, opts);
        if (t) await runAgent(a, t);
      }
    } finally { checking = false; }
  }

  // ---- running an agent ---------------------------------------------------------------
  function feedAdd(item) {
    const f = ls.get(K.feed, []);
    f.unshift(item);
    ls.set(K.feed, f.slice(0, 150));
  }

  async function onDeviceModel(prompt, maxWords) {
    try {
      const LM = self.LanguageModel;
      if (!LM || (await LM.availability()) !== 'available') return undefined;
      const s = await LM.create();
      const out = await s.prompt(`${prompt}\n\nAnswer in at most ${maxWords} words.`);
      s.destroy?.();
      return out;
    } catch { return undefined; }
  }

  function runAgent(a, trigger) {
    if (R.running.has(a.agentId)) return Promise.resolve(null);
    const pkg = a.package;
    const m = pkg.manifest;
    const perms = new Set(m.permissions || []);
    const allow = new Set(((m.http && m.http.allow) || []).map((h) => h.toLowerCase()));
    const maxSteps = Number((m.budget && m.budget.steps) || 30);
    const maxHandoffs = Number((m.budget && m.budget.handoffsPerRun) ?? 1);
    const live = a.channel === 'live';
    const record = { notifications: [], log: [], steps: 0, handoffs: 0, httpReads: 0 };
    R.running.add(a.agentId);
    markRun(a.agentId, trigger.type);
    render();

    const tools = {
      async memoryGet(k) { return (ls.get(K.mem(a.agentId), {}))[String(k)] ?? null; },
      async memorySet(k, v) {
        const mem = ls.get(K.mem(a.agentId), {});
        if (v === null) delete mem[String(k)]; else mem[String(k)] = v;
        if (JSON.stringify(mem).length > 200000) throw new Error('This agent\'s memory is over 200 KB on this phone.');
        ls.set(K.mem(a.agentId), mem);
        return true;
      },
      async notify(n) {
        const item = { agentId: a.agentId, icon: a.icon, agent: a.title, title: String(n.title).slice(0, 120), body: String(n.body || '').slice(0, 1200), at: Date.now(), shadow: !live };
        record.notifications.push({ title: item.title, body: item.body });
        feedAdd(item);
        if (live) {
          try {
            const reg = await navigator.serviceWorker?.ready;
            if (reg && Notification.permission === 'granted') await reg.showNotification(`${a.icon || ''} ${item.title}`.trim(), { body: item.body, tag: `agent:${a.agentId}:${item.at}`, icon: '/icon.svg', badge: '/icon.svg', data: { url: '/runtime#feed' } });
            else toast(`${item.title}: ${item.body}`.slice(0, 160));
          } catch { toast(`${item.title}: ${item.body}`.slice(0, 160)); }
        }
        return true;
      },
      async httpGet(url) {
        const u = new URL(url);
        if (u.protocol !== 'https:' || !allow.has(u.hostname.toLowerCase())) throw new Error(`${u.hostname} is not in this agent's http.allow.`);
        record.httpReads += 1;
        return device('http', { agentId: a.agentId, url: u.toString() });
      },
      location() {
        return new Promise((resolve) => {
          if (!navigator.geolocation) return resolve(null);
          navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), () => resolve(null), { timeout: 12000, maximumAge: 5 * 60000, enableHighAccuracy: false });
        });
      },
      async model(prompt, opts) {
        const local = await onDeviceModel(prompt, (opts && opts.maxWords) || 150);
        if (local !== undefined) return local;
        try { return (await device('handoff', { agentId: a.agentId, prompt, kind: 'model' })).text ?? null; } catch { return null; }
      },
      async handoff(prompt) {
        record.handoffs += 1;
        if (record.handoffs > maxHandoffs) throw new Error('Hand-off budget for this run is used up.');
        try { return (await device('handoff', { agentId: a.agentId, prompt })).text ?? null; } catch { return null; }
      },
    };
    const PERM_OF = { memoryGet: 'memory', memorySet: 'memory', notify: 'notify', httpGet: 'http', location: 'location', model: 'model', handoff: 'handoff' };

    return new Promise((resolve) => {
      const w = new Worker('/agent-worker.js');
      let finished = false;
      const finish = (res) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        w.terminate();
        R.running.delete(a.agentId);
        const run = {
          agentId: a.agentId, version: m.version, channel: live ? 'live' : 'shadow', trigger: trigger.type,
          ok: !!res.ok, error: res.ok ? null : res.error, steps: record.steps, durationMs: res.durationMs || 0,
          notifications: record.notifications, log: record.log.slice(-30), handoffs: record.handoffs, httpReads: record.httpReads,
        };
        report(run);
        const l = lastRuns(); l[a.agentId] = { ...(l[a.agentId] || {}), result: { ok: run.ok, error: run.error, at: Date.now(), said: record.notifications[0]?.title || null } }; ls.set(K.last, l);
        if (!run.ok) toast(`${a.title}: ${run.error}`, 'bad');
        else if (!live && record.notifications.length) toast(`Shadow: ${a.title} would have said “${record.notifications[0].title}”`);
        render();
        resolve(run);
      };
      const timer = setTimeout(() => finish({ ok: false, error: `Stopped after ${RUN_TIMEOUT_MS / 1000} s.` }), RUN_TIMEOUT_MS);
      w.onerror = (e) => { e.preventDefault?.(); finish({ ok: false, error: `The agent could not start: ${e.message || 'worker error'}` }); };
      w.onmessage = async (ev) => {
        const msg = ev.data || {};
        if (msg.type === 'log') { record.log.push(String(msg.line).slice(0, 300)); return; }
        if (msg.type === 'done') { finish(msg); return; }
        if (msg.type !== 'call') return;
        const reply = (ok, value, error) => { if (!finished) w.postMessage({ type: 'reply', id: msg.id, ok, value, error }); };
        // The page checks again: the worker's own checks are not trusted.
        const perm = PERM_OF[msg.fn];
        if (!perm || !perms.has(perm)) return reply(false, null, `Not allowed: ${msg.fn}.`);
        record.steps += 1;
        if (record.steps > maxSteps) { reply(false, null, 'Step budget exceeded.'); return finish({ ok: false, error: `Step budget exceeded: more than ${maxSteps} ctx calls in one run.` }); }
        try { reply(true, await tools[msg.fn](...(msg.args || []))); } catch (e) { reply(false, null, e.message); }
      };
      w.postMessage({ type: 'run', code: pkg.code, manifest: m, trigger, settings: (R.state.agents.find((x) => x.agentId === a.agentId) || {}).settings || {} });
    });
  }

  async function report(run) {
    const box = ls.get(K.outbox, []);
    box.push(run);
    ls.set(K.outbox, box.slice(-50));
    flushOutbox();
  }
  let flushing = false;
  async function flushOutbox() {
    if (flushing || !R.pair) return;
    flushing = true;
    try {
      let box = ls.get(K.outbox, []);
      while (box.length) {
        try { await device('runs', box[0]); } catch (e) { if (!e.status || e.status >= 500 || e.status === 429) break; }
        box = ls.get(K.outbox, []).slice(1);
        ls.set(K.outbox, box);
      }
    } finally { flushing = false; }
  }

  // ---- notifications on this phone ------------------------------------------------------
  async function enablePush(btn) {
    if (isIOS() && !standalone()) return sheetInstall();
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return toast('This browser cannot receive notifications.', 'bad');
    if (btn) btn.disabled = true;
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed. You can allow them in Settings.');
      const reg = await navigator.serviceWorker.ready;
      const key = R.state?.pushKey;
      if (!key) throw new Error('Open the Runtime online once first.');
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
      await device('hello', { tz: tz(), subscription: sub.toJSON() });
      toast('Notifications are on. Scheduled agents can wake this phone.');
      render();
    } catch (e) { toast(e.message, 'bad'); } finally { if (btn) btn.disabled = false; }
  }
  function sheetInstall() {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = `<div class="sheet"><div class="grab"></div><div class="stack">
      <div class="h2">Add it to your Home Screen</div>
      <p class="muted" style="margin:0">On iPhone, only Home Screen apps can get notifications, and notifications are how scheduled agents wake up.</p>
      <ol class="prose" style="margin:0;padding-left:20px"><li>Tap <strong>Share</strong> in Safari's toolbar.</li><li>Choose <strong>Add to Home Screen</strong>.</li><li>Open <strong>Pocket</strong> from your Home Screen and tap <strong>Allow notifications</strong>.</li></ol>
      <div class="row" style="justify-content:flex-end"><button class="btn sm" data-close>Got it</button></div></div></div>`;
    scrim.addEventListener('click', (e) => { if (e.target === scrim || e.target.closest('[data-close]')) { scrim.classList.add('out'); setTimeout(() => scrim.remove(), 300); } });
    document.body.append(scrim);
  }

  // ---- pairing --------------------------------------------------------------------------
  async function pairHere(name, btn) {
    btn.disabled = true;
    try {
      const res = await fetch('/api/devices/pair', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, tz: tz() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Pairing failed.');
      R.pair = { token: data.token, publicKey: data.publicKey, deviceId: data.device.id, name: data.device.name, pairedAt: Date.now() };
      if (!ls.set(K.pair, R.pair)) throw new Error('This browser will not keep data (private mode?). Pairing needs it.');
      R.problem = null;
      toast('Paired. This phone now runs your agents.');
      await sync();
    } catch (e) { toast(e.message, 'bad'); } finally { btn.disabled = false; }
  }

  // ---- screens --------------------------------------------------------------------------
  function render() {
    if (!R.pair) return renderPair();
    const st = R.state;
    const pushOn = 'Notification' in window && Notification.permission === 'granted';
    const agents = st ? st.agents : [];
    const feed = ls.get(K.feed, []);
    const unsupported = R.verified._unsupported;
    app.innerHTML = `<div class="shell">
      <header class="top">
        <a class="brand" href="/runtime"><span class="mark"></span><span>Pocket</span></a>
        <span class="spacer"></span>
        ${R.offline ? '<span class="pill warn">Offline</span>' : ''}
        <a class="btn ghost sm" href="/">Studio</a>
      </header>
      <section style="padding:22px 0 18px" class="rise">
        <div class="eyebrow">${esc(R.pair.name)}${st?.owner ? ` · ${esc(st.owner.firstName)}` : ''}</div>
        <h1 class="display" style="margin-top:8px;font-size:clamp(38px,10vw,58px)">Your agents, <em>on you</em>.</h1>
      </section>
      ${R.problem ? `<div class="note bad rise" style="margin-bottom:14px">${esc(R.problem)}</div>` : ''}
      ${unsupported ? '<div class="note bad rise" style="margin-bottom:14px">This browser cannot check package signatures (Ed25519), so nothing runs here. Update iOS / your browser.</div>' : ''}
      ${pushOn ? '' : `<section class="glass card row rise" style="gap:14px;margin-bottom:16px"><div class="avatar">🔔</div><div style="flex:1;min-width:0"><div class="h3">Let scheduled agents wake this phone</div><div class="small muted">${isIOS() && !standalone() ? 'Add Pocket to your Home Screen first.' : 'Allow notifications once.'}</div></div><button class="btn sm" data-act="push">${isIOS() && !standalone() ? 'How' : 'Allow'}</button></section>`}
      <div class="tabs glass rise" role="tablist">
        <button class="tab ${R.tab === 'agents' ? 'on' : ''}" data-act="tab" data-tab="agents">Agents</button>
        <button class="tab ${R.tab === 'feed' ? 'on' : ''}" data-act="tab" data-tab="feed">Feed${feed.length ? ` · ${Math.min(feed.length, 99)}` : ''}</button>
        <button class="tab ${R.tab === 'phone' ? 'on' : ''}" data-act="tab" data-tab="phone">This phone</button>
      </div>
      <div style="margin-top:16px">${R.tab === 'feed' ? feedView(feed) : R.tab === 'phone' ? phoneView(st) : agentsView(agents)}</div>
    </div>`;
  }

  function agentsView(agents) {
    if (!R.state) return '<div class="glass empty">Loading your agents…</div>';
    if (!agents.length) return '<div class="glass empty">No agents released yet. Build one in the <a class="link" href="/">Studio</a>; it appears here in shadow mode.</div>';
    const last = lastRuns();
    return `<div class="stack">${agents.map((a) => {
      const l = last[a.agentId] || {};
      const v = R.verified[a.agentId];
      const due = a.package && a.channel !== 'off' ? nextDue(a) : null;
      const pill = a.channel === 'off' ? '<span class="pill">Off</span>' : v === false ? '<span class="pill bad">Bad signature</span>' : a.channel === 'live' ? '<span class="pill good"><span class="dot"></span>Live</span>' : '<span class="pill accent">Shadow</span>';
      const line = (a.missingSettings || []).length ? `Needs settings in the Studio: ${a.missingSettings.join(', ')}`
        : R.running.has(a.agentId) ? 'Running…'
        : l.result ? `${l.result.ok ? 'Ran' : 'Failed'} ${ago(l.result.at)}${l.result.said ? ` · “${l.result.said}”` : ''}${due ? ` · next ${when(due)}` : ''}`
        : due ? `Next ${when(due)}` : 'Not run yet';
      return `<article class="glass card rise">
        <div class="row" style="gap:14px">
          <div class="avatar">${esc(a.icon || '✳︎')}</div>
          <div style="flex:1;min-width:0"><div class="h3" style="font-size:16.5px">${esc(a.title)}</div><div class="small muted" style="overflow:hidden;text-overflow:ellipsis">${esc(line)}</div></div>
          ${pill}
        </div>
        ${runnable(a) ? `<div class="row" style="margin-top:14px;justify-content:space-between"><span class="tiny faint">v${esc(a.package.manifest.version)} · signed ✓</span><button class="btn sm" data-act="run" data-id="${esc(a.agentId)}" ${R.running.has(a.agentId) ? 'disabled' : ''}>${R.running.has(a.agentId) ? '<span class="spin"></span>' : 'Run now'}</button></div>` : ''}
      </article>`;
    }).join('')}</div>`;
  }

  function feedView(feed) {
    if (!feed.length) return '<div class="glass empty">What your agents say shows up here. In shadow mode this is the only place it shows up.</div>';
    return `<div class="stack">${feed.slice(0, 80).map((f) => `<div class="feed-item rise">
      <div class="row between"><span class="small" style="font-weight:600">${esc(f.icon || '')} ${esc(f.agent)}</span>${f.shadow ? '<span class="pill accent">would have said</span>' : ''}</div>
      <div class="t" style="margin-top:6px">${esc(f.title)}</div><div class="b">${esc(f.body)}</div><div class="m">${ago(f.at)}</div></div>`).join('')}
      <div class="row" style="justify-content:center"><button class="btn ghost sm" data-act="clear-feed">Clear</button></div></div>`;
  }

  function phoneView(st) {
    const out = ls.get(K.outbox, []);
    return `<div class="stack-lg"><section class="glass card">
      <dl class="kv">
        <dt>Name</dt><dd>${esc(R.pair.name)}</dd>
        <dt>Time zone</dt><dd>${esc(tz())}</dd>
        <dt>Paired</dt><dd>${ago(R.pair.pairedAt)}</dd>
        <dt>Studio key</dt><dd class="mono">${esc(R.pair.publicKey.slice(0, 16))}…</dd>
        <dt>Notifications</dt><dd>${'Notification' in window ? esc(Notification.permission) : 'not supported'}</dd>
        <dt>Hand-offs today</dt><dd>${st ? `${st.handoff.used} of ${st.handoff.cap}` : '—'}</dd>
        <dt>Unsent reports</dt><dd>${out.length}</dd>
      </dl></section>
      <section class="glass card stack"><div class="h3">How agents run here</div>
        <p class="small muted" style="margin:0">Phones don't keep anything running in the background. At each scheduled time your Studio sends a notification; opening it (or opening Pocket) runs whatever is due, up to three hours late. Agents with an interval run whenever Pocket is open and their interval has passed.</p></section>
      <div class="row wrap"><button class="btn soft sm" data-act="sync">Check for updates</button><button class="btn danger sm" data-act="unpair">Unpair this phone</button></div></div>`;
  }

  async function renderPair() {
    if (!R.session) R.session = await fetch('/api/session', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ authed: false }));
    const guess = isIOS() ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'This device';
    app.innerHTML = `<div class="center"><section class="auth glass rise">
      <div class="brand" style="margin-bottom:26px"><span class="mark"></span>Pocket</div>
      <h1 class="display" style="font-size:42px">Pair this <em>phone</em></h1>
      <p class="muted" style="margin:12px 0 22px">Pocket runs the agents you build in your Studio, right here. It only runs packages signed by your Studio.</p>
      ${R.problem ? `<div class="note bad" style="margin-bottom:14px">${esc(R.problem)}</div>` : ''}
      ${R.session.authed ? `<div class="stack">
          <label class="field"><span>Call it</span><input class="input" id="pname" value="${esc(guess)}" maxlength="40"></label>
          <button class="btn" style="width:100%" data-act="pair">Pair this phone</button>
          <p class="tiny faint" style="margin:6px 0 0">Signed in as ${esc(R.session.user.email)}.</p></div>`
        : `<a class="btn" style="width:100%" href="/?next=/runtime#/login">Sign in to pair</a>`}
    </section></div>`;
  }

  // ---- events ---------------------------------------------------------------------------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'pair') return pairHere($('#pname')?.value || 'Phone', el);
    if (act === 'push') return enablePush(el);
    if (act === 'tab') { R.tab = el.dataset.tab; return render(); }
    if (act === 'run') { const a = R.state.agents.find((x) => x.agentId === el.dataset.id); if (a) await runAgent(a, { type: 'manual' }); return; }
    if (act === 'clear-feed') { ls.set(K.feed, []); return render(); }
    if (act === 'sync') { await sync(); toast('Up to date.'); return; }
    if (act === 'unpair') {
      if (!confirm('Unpair this phone? Its agents stop running here.')) return;
      try { await fetch(`/api/devices/${R.pair.deviceId}`, { method: 'DELETE', credentials: 'same-origin' }); } catch {}
      return unpairLocal(null);
    }
  });

  async function wake({ opened = true } = {}) {
    if (!R.pair) return render();
    await sync({ quiet: true });
    const m = location.hash.match(/run=([a-f0-9]{12})/);
    if (m) history.replaceState(null, '', '/runtime');
    if (location.hash === '#feed') { R.tab = 'feed'; history.replaceState(null, '', '/runtime'); render(); }
    await checkDue({ opened });
  }

  // ---- start ----------------------------------------------------------------------------
  const theme = ls.get('pb.theme', 'system');
  if (theme !== 'system') document.documentElement.dataset.theme = theme;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  // The core helps compute next-due times on this page too (no network, no eval).
  const s = document.createElement('script'); s.src = '/agent-core.js'; s.onload = () => render(); document.head.append(s);

  if (R.state && R.pair) verifyAll(R.state).then((v) => { R.verified = v; render(); });
  render();
  wake();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
  addEventListener('hashchange', () => wake());
  addEventListener('online', () => { flushOutbox(); sync({ quiet: true }); });
  setInterval(() => { if (!document.hidden) checkDue({ opened: false }); }, 60000);
  // Tell the Studio this phone's time zone (it schedules wake-ups by it).
  if (R.pair) device('hello', { tz: tz() }).catch(() => {});
})();
