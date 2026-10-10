#!/usr/bin/env node
// Runs one agent once for the Studio's cloud runs, in its own process.
//
// The Studio starts this as the unprivileged build user inside bubblewrap
// with no network (--unshare-net). The agent's code runs in a VM context with
// nothing but ctx; every ctx call becomes a line on stdout, and the Studio
// answers on stdin after checking it again against the signed manifest.
'use strict';

const readline = require('readline');
const { makeCtx } = require('./core');
const { compile } = require('./evals');

const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const pending = new Map();
let seq = 0;
const call = (fn, ...args) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  out({ type: 'call', id, fn, args });
});

async function run(job) {
  const started = Date.now();
  const host = {
    log: (line) => out({ type: 'log', line: String(line) }),
    memoryGet: (k) => call('memoryGet', k),
    memorySet: (k, v) => call('memorySet', k, v),
    notify: (n) => call('notify', n),
    httpGet: (u) => call('httpGet', u),
    location: () => call('location'),
    model: (p, o) => call('model', p, o),
    handoff: (p) => call('handoff', p),
  };
  let made;
  try {
    made = makeCtx({ manifest: job.manifest, trigger: job.trigger, settings: job.settings, host, tz: job.tz });
    const fn = compile(job.code);
    await fn(made.ctx);
    out({ type: 'done', ok: true, steps: made.steps(), handoffs: made.handoffs(), durationMs: Date.now() - started });
  } catch (e) {
    out({ type: 'done', ok: false, error: String((e && e.message) || e).slice(0, 500), steps: made ? made.steps() : 0, handoffs: made ? made.handoffs() : 0, durationMs: Date.now() - started });
  }
  setTimeout(() => process.exit(0), 50);
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.type === 'run') run(m);
  else if (m.type === 'reply') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || 'The Studio refused that.'));
  }
});
