// Runs one agent, once, then the Runtime ends this worker.
//
// The worker is served with `connect-src 'none'`: it cannot reach the network.
// Before the agent's code is compiled, every other way out is removed
// (fetch, sockets, importScripts, string timers, the Function constructors),
// so the agent's only door is ctx, and every ctx call is a message the
// Runtime page checks again against the signed manifest.
'use strict';

importScripts('/agent-core.js');
const Core = self.PocketCore;
const post = self.postMessage.bind(self);
const pending = new Map();
let seq = 0;

function call(fn, ...args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    post({ type: 'call', id, fn, args });
  });
}

const host = {
  log: (line) => post({ type: 'log', line: String(line) }),
  memoryGet: (k) => call('memoryGet', k),
  memorySet: (k, v) => call('memorySet', k, v),
  notify: (n) => call('notify', n),
  httpGet: (u) => call('httpGet', u),
  location: () => call('location'),
  model: (p, o) => call('model', p, o),
  handoff: (p) => call('handoff', p),
};

function lockdown() {
  const realSetTimeout = setTimeout;
  const realSetInterval = setInterval;
  const blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'importScripts', 'Worker', 'SharedWorker',
    'BroadcastChannel', 'MessageChannel', 'indexedDB', 'caches', 'navigator', 'postMessage', 'close', 'eval', 'Request', 'Response', 'PocketCore'];
  for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of blocked) { try { if (Object.prototype.hasOwnProperty.call(o, k)) delete o[k]; } catch {} }
  }
  for (const k of blocked) { try { Object.defineProperty(self, k, { value: undefined, writable: false, configurable: false }); } catch {} }
  // Timers take functions only (a string would be compiled as code).
  const onlyFn = (real) => function (fn, ms, ...rest) { if (typeof fn !== 'function') throw new TypeError('Timers take a function.'); return real(fn, ms, ...rest); };
  try { Object.defineProperty(self, 'setTimeout', { value: onlyFn(realSetTimeout), writable: false, configurable: false }); } catch {}
  try { Object.defineProperty(self, 'setInterval', { value: onlyFn(realSetInterval), writable: false, configurable: false }); } catch {}
  // No route back to a code compiler.
  const ctors = [function () {}, async function () {}, function* () {}, async function* () {}].map((f) => Object.getPrototypeOf(f));
  for (const proto of ctors) { try { Object.defineProperty(proto, 'constructor', { value: undefined, writable: false, configurable: false }); } catch {} }
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m.type === 'reply') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || 'The Runtime refused that.'));
    return;
  }
  if (m.type !== 'run') return;
  const started = Date.now();
  let made;
  try {
    made = Core.makeCtx({ manifest: m.manifest, trigger: m.trigger, settings: m.settings, host, tz: m.tz });
    // Compile first (needs the compiler), then remove every way to compile more.
    // eslint-disable-next-line no-new-func
    const compiled = new Function('ctx', `'use strict';\n${m.code}\n;return run(ctx);`);
    lockdown();
    await compiled.call(undefined, made.ctx);
    post({ type: 'done', ok: true, steps: made.steps(), handoffs: made.handoffs(), durationMs: Date.now() - started });
  } catch (e) {
    post({ type: 'done', ok: false, error: String((e && e.message) || e).slice(0, 500), steps: made ? made.steps() : 0, handoffs: made ? made.handoffs() : 0, durationMs: Date.now() - started });
  }
};
