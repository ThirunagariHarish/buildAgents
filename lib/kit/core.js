// Pocket Box agent core: the contract every agent package follows, shared by
// the eval runner (Node), the Studio's release gate and the phone Runtime
// (browser worker). Plain JavaScript, no dependencies, no I/O of its own.
//
// An agent is:
//   agent.json  the manifest (name, permissions, triggers, settings, budget)
//   agent.js    defines `async function run(ctx)`; no imports, no globals
//   evals/*.json scenarios with fixtures and expectations
//
// Everything an agent can do goes through `ctx`, and every ctx call needs a
// permission declared in agent.json and counts against the step budget.

(function (root) {
  const PERMISSIONS = {
    notify: 'Show you a notification',
    memory: 'Remember things between runs, on your phone',
    location: 'Read your current location when it runs',
    http: 'Read from the web addresses listed in its manifest, through your Studio',
    model: 'Use a language model (on the phone if it has one, otherwise a hand-off)',
    handoff: 'Ask your Studio for hard reasoning (Claude Code on your plan, owner only)',
  };
  const TRIGGERS = ['schedule', 'interval', 'manual', 'open'];
  const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const SETTING_TYPES = ['text', 'url', 'number', 'secret', 'time'];

  // Words an agent's code may not use: it has no way out except ctx.
  const FORBIDDEN = ['require', 'import', 'process', 'globalThis', 'window', 'self', 'document', 'fetch',
    'XMLHttpRequest', 'WebSocket', 'importScripts', 'eval', 'Function', 'constructor', '__proto__', 'Worker', 'postMessage'];

  function slugOk(s) { return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{1,48}$/.test(s); }

  /** Problems with a manifest, as plain sentences. Empty array = valid. */
  function validateManifest(m) {
    const p = [];
    if (!m || typeof m !== 'object') return ['agent.json is not a JSON object.'];
    if (!slugOk(m.id)) p.push('id must be lowercase letters, digits and dashes, 2-49 characters.');
    if (!m.name || String(m.name).length > 40) p.push('name is required, at most 40 characters.');
    if (!m.description || String(m.description).length > 240) p.push('description is required, at most 240 characters.');
    if (!/^\d+\.\d+\.\d+$/.test(String(m.version || ''))) p.push('version must look like 1.0.0.');
    if (m.icon && [...String(m.icon)].length > 2) p.push('icon is one emoji.');
    const perms = Array.isArray(m.permissions) ? m.permissions : null;
    if (!perms) p.push('permissions must be a list (it can be empty).');
    else for (const x of perms) if (!PERMISSIONS[x]) p.push(`Unknown permission "${x}". Known: ${Object.keys(PERMISSIONS).join(', ')}.`);
    if (perms && perms.includes('http')) {
      const allow = m.http && Array.isArray(m.http.allow) ? m.http.allow : [];
      if (!allow.length) p.push('Permission "http" needs http.allow: the host names it may read, e.g. ["api.weather.gov"].');
      for (const h of allow) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(h))) p.push(`http.allow entry "${h}" must be a bare host name.`);
    }
    const trig = Array.isArray(m.triggers) ? m.triggers : null;
    if (!trig || !trig.length) p.push('triggers must list at least one trigger.');
    else for (const t of trig) {
      if (!t || !TRIGGERS.includes(t.type)) { p.push(`Trigger type must be one of ${TRIGGERS.join(', ')}.`); continue; }
      if (t.type === 'schedule') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t.at || ''))) p.push('A schedule trigger needs at: "HH:MM" (24-hour, the phone\'s time zone).');
        if (t.days && (!Array.isArray(t.days) || t.days.some((d) => !DAYS.includes(d)))) p.push(`schedule.days uses ${DAYS.join(', ')}.`);
      }
      if (t.type === 'interval' && !(Number(t.minutes) >= 15 && Number(t.minutes) <= 1440)) p.push('An interval trigger needs minutes between 15 and 1440.');
    }
    if (m.settings !== undefined) {
      if (!Array.isArray(m.settings)) p.push('settings must be a list.');
      else for (const s of m.settings) {
        if (!s || !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(String(s.key || ''))) p.push('Each setting needs a key (letters, digits, underscore).');
        if (!s || !s.label) p.push(`Setting "${s && s.key}" needs a label the owner reads.`);
        if (s && s.type && !SETTING_TYPES.includes(s.type)) p.push(`Setting "${s.key}" type must be one of ${SETTING_TYPES.join(', ')}.`);
      }
    }
    const steps = m.budget && m.budget.steps;
    if (steps !== undefined && !(Number(steps) >= 1 && Number(steps) <= 200)) p.push('budget.steps must be between 1 and 200.');
    const ho = m.budget && m.budget.handoffsPerRun;
    if (ho !== undefined && !(Number(ho) >= 0 && Number(ho) <= 5)) p.push('budget.handoffsPerRun must be between 0 and 5.');
    return p;
  }

  /** Strip comments and strings so word checks only see code. */
  // One pass, left to right, so a "//" inside a string or a quote inside a
  // regular expression cannot hide the code after it. Expressions inside
  // template literals (`${...}`) are code and are kept.
  function codeOnly(src) {
    const s = String(src);
    let out = '', i = 0;
    const KW = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)\s*$/;
    const regexCanStart = () => { const t = out.replace(/\s+$/, ''); return !t || /[(,=:[!&|?{};+\-*%<>~^]$/.test(t) || KW.test(t); };
    while (i < s.length) {
      const c = s[i], n = s[i + 1];
      if (c === '/' && n === '/') { while (i < s.length && s[i] !== '\n') i++; out += ' '; continue; }
      if (c === '/' && n === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; out += ' '; continue; }
      if (c === '"' || c === "'") {
        i++;
        while (i < s.length && s[i] !== c && s[i] !== '\n') i += s[i] === '\\' ? 2 : 1;
        i++; out += c + c; continue;
      }
      if (c === '`') {
        i++; out += '`';
        while (i < s.length && s[i] !== '`') {
          if (s[i] === '\\') { i += 2; continue; }
          if (s[i] === '$' && s[i + 1] === '{') {
            let depth = 1, j = i + 2;
            while (j < s.length && depth) {
              const ch = s[j];
              if (ch === '\\') { j += 2; continue; }
              if (ch === '"' || ch === "'" || ch === '`') { const q = ch; j++; while (j < s.length && s[j] !== q) j += s[j] === '\\' ? 2 : 1; j++; continue; }
              if (ch === '{') depth++; else if (ch === '}') depth--;
              j++;
            }
            out += ` ${codeOnly(s.slice(i + 2, j - 1))} `;
            i = j; continue;
          }
          i++;
        }
        i++; out += '`'; continue;
      }
      if (c === '/' && regexCanStart()) {
        let j = i + 1, cls = false;
        while (j < s.length && s[j] !== '\n') {
          if (s[j] === '\\') { j += 2; continue; }
          if (s[j] === '[') cls = true; else if (s[j] === ']') cls = false; else if (s[j] === '/' && !cls) break;
          j++;
        }
        if (s[j] === '/') { j++; while (/[a-z]/i.test(s[j] || '')) j++; out += '/r/'; i = j; continue; }
      }
      out += c; i++;
    }
    return out;
  }

  /** Problems with the code against its manifest; warnings don't block a release. */
  function checkCode(code, manifest) {
    const problems = [], warnings = [];
    const src = String(code || '');
    if (!src.trim()) return { problems: ['agent.js is empty.'], warnings };
    if (src.length > 60000) problems.push('agent.js is over 60 KB; keep agents small.');
    const bare = codeOnly(src);
    if (!/\basync\s+function\s+run\s*\(\s*ctx\s*\)/.test(bare)) problems.push('agent.js must define `async function run(ctx)` at the top level.');
    for (const w of FORBIDDEN) if (new RegExp(`(^|[^.\\w$])${w}\\b`).test(bare)) problems.push(`agent.js uses "${w}", which agents cannot use. Everything goes through ctx.`);
    const used = new Set();
    for (const m of bare.matchAll(/\bctx\s*\.\s*(notify|memory|location|http|model|handoff)\b/g)) used.add(m[1]);
    const declared = new Set((manifest && manifest.permissions) || []);
    for (const u of used) if (!declared.has(u)) problems.push(`agent.js uses ctx.${u} but agent.json does not declare the "${u}" permission.`);
    for (const d of declared) if (!used.has(d)) warnings.push(`Permission "${d}" is declared but never used; remove it so the owner is asked for less.`);
    return { problems, warnings };
  }

  /**
   * Build the ctx an agent's run() receives. `host` supplies the real
   * capabilities (async functions); this layer enforces permissions, the step
   * budget, the http allow-list, and the shapes of what goes in and out.
   */
  function makeCtx({ manifest, trigger, settings, host, nowIso }) {
    const declared = new Set(manifest.permissions || []);
    const maxSteps = Number((manifest.budget && manifest.budget.steps) || 30);
    const maxHandoffs = Number((manifest.budget && manifest.budget.handoffsPerRun) ?? 1);
    const allow = new Set(((manifest.http && manifest.http.allow) || []).map((h) => String(h).toLowerCase()));
    let steps = 0, handoffs = 0;
    const step = () => { steps += 1; if (steps > maxSteps) throw new Error(`Step budget exceeded: more than ${maxSteps} ctx calls in one run.`); };
    const need = (perm) => { if (!declared.has(perm)) throw new Error(`This agent did not declare the "${perm}" permission.`); };
    const clean = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
    const ctx = {
      trigger: Object.freeze({ ...(trigger || { type: 'manual' }) }),
      settings: Object.freeze({ ...(settings || {}) }),
      now: () => (nowIso ? nowIso() : new Date().toISOString()),
      log: (...a) => { host.log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').slice(0, 500)); },
      memory: Object.freeze({
        get: async (key) => { need('memory'); step(); return clean(await host.memoryGet(String(key).slice(0, 64))); },
        set: async (key, value) => {
          need('memory'); step();
          const v = clean(value);
          if (JSON.stringify(v).length > 20000) throw new Error('A memory value is over 20 KB.');
          return host.memorySet(String(key).slice(0, 64), v);
        },
      }),
      notify: async (n) => {
        need('notify'); step();
        if (!n || !n.title) throw new Error('ctx.notify needs { title, body }.');
        await host.notify({ title: String(n.title).slice(0, 120), body: String(n.body || '').slice(0, 1200) });
        return true;
      },
      http: Object.freeze({
        get: async (url) => {
          need('http'); step();
          let u;
          try { u = new URL(String(url)); } catch { throw new Error(`ctx.http.get: "${url}" is not a URL.`); }
          if (u.protocol !== 'https:') throw new Error('ctx.http.get only reads https addresses.');
          if (!allow.has(u.hostname.toLowerCase())) throw new Error(`ctx.http.get: ${u.hostname} is not in http.allow in agent.json.`);
          const r = await host.httpGet(u.toString());
          return { status: Number(r && r.status) || 0, text: String((r && r.text) || '').slice(0, 500000) };
        },
      }),
      location: Object.freeze({
        current: async () => { need('location'); step(); const l = await host.location(); return l ? { lat: Number(l.lat), lon: Number(l.lon) } : null; },
      }),
      model: Object.freeze({
        generate: async (prompt, opts) => {
          need('model'); step();
          const out = await host.model(String(prompt).slice(0, 8000), { maxWords: Math.min(Number((opts && opts.maxWords) || 150), 600) });
          return out == null ? null : String(out);
        },
      }),
      handoff: async (prompt) => {
        need('handoff'); step();
        handoffs += 1;
        if (handoffs > maxHandoffs) throw new Error(`More than ${maxHandoffs} hand-off(s) in one run.`);
        const out = await host.handoff(String(prompt).slice(0, 8000));
        return out == null ? null : String(out);
      },
    };
    return { ctx: Object.freeze(ctx), steps: () => steps, handoffs: () => handoffs };
  }

  /** When a schedule/interval trigger is next due after `from` (a Date), in local time. */
  function nextDue(trigger, from, lastRunAt) {
    const d = new Date(from.getTime());
    if (trigger.type === 'interval') {
      const last = lastRunAt ? new Date(lastRunAt) : null;
      return last ? new Date(last.getTime() + Number(trigger.minutes) * 60000) : d;
    }
    if (trigger.type !== 'schedule') return null;
    const [h, m] = String(trigger.at).split(':').map(Number);
    for (let i = 0; i < 8; i++) {
      const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h, m, 0, 0);
      if (c <= from) continue;
      if (trigger.days && trigger.days.length && !trigger.days.includes(DAYS[c.getDay()])) continue;
      return c;
    }
    return null;
  }

  const api = { PERMISSIONS, TRIGGERS, DAYS, SETTING_TYPES, FORBIDDEN, validateManifest, checkCode, codeOnly, makeCtx, nextDue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PocketCore = api;
})(typeof self !== 'undefined' ? self : this);
