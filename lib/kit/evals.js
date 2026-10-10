#!/usr/bin/env node
// Pocket Box agent kit: validate an agent and run its eval scenarios.
//
//   node agentkit/evals.js            human-readable report, exit 1 on failure
//   node agentkit/evals.js --json     machine-readable report
//   node agentkit/evals.js --validate only check agent.json and agent.js
//
// Run from the agent's repository root (where agent.json lives). The agent's
// code runs in a fresh VM context with nothing but ctx; every capability is a
// fixture from the scenario file, so evals are deterministic and offline.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { validateManifest, checkCode, makeCtx } = require('./core');

const ROOT = process.cwd();
const asJson = process.argv.includes('--json');
const validateOnly = process.argv.includes('--validate');
const RUN_TIMEOUT_MS = 10000;

function readJson(file) {
  try { return { value: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { return { error: `${path.relative(ROOT, file)}: ${e.message}` }; }
}

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function compile(code) {
  const sandbox = Object.create(null);
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  const run = vm.runInContext(`${code}\n;typeof run === 'function' ? run : undefined`, context, { timeout: 2000, filename: 'agent.js' });
  if (typeof run !== 'function') throw new Error('agent.js does not define run(ctx).');
  return run;
}

/** Run one scenario; returns { name, pass, failures, steps, notifications, memory, log, error }. */
async function runScenario(manifest, code, sc) {
  const memory = { ...(sc.memory || {}) };
  const notifications = [], log = [], httpCalls = [], unmocked = [];
  const models = Array.isArray(sc.model) ? [...sc.model] : [];
  const handoffs = Array.isArray(sc.handoff) ? [...sc.handoff] : [];
  const host = {
    log: (s) => log.push(s),
    memoryGet: async (k) => (k in memory ? memory[k] : null),
    memorySet: async (k, v) => { memory[k] = v; },
    notify: async (n) => { notifications.push(n); },
    httpGet: async (url) => {
      httpCalls.push(url);
      const fx = sc.http || {};
      const key = Object.keys(fx).find((k) => url === k || (k.endsWith('*') && url.startsWith(k.slice(0, -1))));
      if (!key) { unmocked.push(url); return { status: 404, text: '' }; }
      const r = fx[key];
      return typeof r === 'string' ? { status: 200, text: r } : { status: r.status ?? 200, text: r.text || '' };
    },
    location: async () => sc.location || null,
    model: async () => (models.length ? models.shift() : null),
    handoff: async () => (handoffs.length ? handoffs.shift() : null),
  };
  const { ctx, steps, handoffs: usedHandoffs } = makeCtx({
    manifest, trigger: sc.trigger || { type: 'manual' }, settings: sc.settings || {}, host,
    nowIso: () => sc.now || '2026-01-05T08:00:00.000Z', tz: sc.tz || 'UTC',
  });
  let error = null;
  let timer;
  try {
    const run = compile(code);
    await Promise.race([
      Promise.resolve(run(ctx)),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`run() took longer than ${RUN_TIMEOUT_MS / 1000}s`)), RUN_TIMEOUT_MS); }),
    ]);
  } catch (e) { error = e && e.message ? e.message : String(e); } finally { clearTimeout(timer); }

  const ex = sc.expect || {};
  const failures = [];
  if (ex.error === undefined || ex.error === false) { if (error) failures.push(`run() failed: ${error}`); }
  else if (ex.error === true && !error) failures.push('expected run() to fail, it succeeded');
  else if (typeof ex.error === 'string' && !(error || '').includes(ex.error)) failures.push(`expected an error containing "${ex.error}", got ${error ? `"${error}"` : 'no error'}`);
  const n = ex.notify;
  if (n) {
    if (n.count !== undefined && notifications.length !== n.count) failures.push(`expected ${n.count} notification(s), got ${notifications.length}`);
    if (n.min !== undefined && notifications.length < n.min) failures.push(`expected at least ${n.min} notification(s), got ${notifications.length}`);
    if (n.max !== undefined && notifications.length > n.max) failures.push(`expected at most ${n.max} notification(s), got ${notifications.length}`);
    const all = notifications.map((x) => `${x.title}\n${x.body}`).join('\n---\n').toLowerCase();
    for (const s of n.titleIncludes || []) if (!notifications.some((x) => x.title.toLowerCase().includes(String(s).toLowerCase()))) failures.push(`no notification title contains "${s}"`);
    for (const s of n.bodyIncludes || []) if (!all.includes(String(s).toLowerCase())) failures.push(`no notification contains "${s}"`);
    for (const s of n.bodyExcludes || []) if (all.includes(String(s).toLowerCase())) failures.push(`a notification contains "${s}", which it must not`);
  }
  for (const [k, v] of Object.entries(ex.memory || {})) {
    if (v && typeof v === 'object' && 'exists' in v) { if (v.exists !== (k in memory && memory[k] !== null)) failures.push(`memory "${k}" ${v.exists ? 'missing' : 'should not be set'}`); }
    else if (!deepEqual(memory[k], v)) failures.push(`memory "${k}" is ${JSON.stringify(memory[k])}, expected ${JSON.stringify(v)}`);
  }
  if (ex.maxSteps !== undefined && steps() > ex.maxSteps) failures.push(`used ${steps()} steps, expected at most ${ex.maxSteps}`);
  if (ex.http && ex.http.max !== undefined && httpCalls.length > ex.http.max) failures.push(`made ${httpCalls.length} web reads, expected at most ${ex.http.max}`);
  if (ex.handoff && ex.handoff.max !== undefined && usedHandoffs() > ex.handoff.max) failures.push(`made ${usedHandoffs()} hand-offs, expected at most ${ex.handoff.max}`);
  if (unmocked.length && !ex.allowUnmocked) failures.push(`read ${unmocked.join(', ')} with no fixture in the scenario's "http"`);
  return { name: sc.name || 'unnamed', pass: !failures.length, failures, steps: steps(), notifications, memory, log, error };
}

async function main() {
  const report = { ok: false, problems: [], warnings: [], scenarios: [] };
  const m = readJson(path.join(ROOT, 'agent.json'));
  if (m.error) report.problems.push(m.error);
  let code = '';
  try { code = fs.readFileSync(path.join(ROOT, 'agent.js'), 'utf8'); } catch { report.problems.push('agent.js is missing.'); }
  if (m.value) report.problems.push(...validateManifest(m.value));
  if (m.value && code) { const c = checkCode(code, m.value); report.problems.push(...c.problems); report.warnings.push(...c.warnings); }
  if (!report.problems.length && !validateOnly) {
    const dir = path.join(ROOT, 'evals');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
    if (files.length < 3) report.problems.push(`Only ${files.length} eval scenario(s) in evals/; at least 3 are required (a normal run, an edge case, a failure the agent must handle).`);
    for (const f of files) {
      const s = readJson(path.join(dir, f));
      if (s.error) { report.scenarios.push({ name: f, pass: false, failures: [s.error] }); continue; }
      const r = await runScenario(m.value, code, s.value);
      report.scenarios.push({ file: f, ...r });
    }
  }
  report.passed = report.scenarios.filter((s) => s.pass).length;
  report.failed = report.scenarios.length - report.passed;
  report.ok = !report.problems.length && report.failed === 0 && (validateOnly || report.scenarios.length >= 3);

  if (asJson) { process.stdout.write(JSON.stringify(report, null, 1)); }
  else {
    for (const p of report.problems) console.log(`✗ ${p}`);
    for (const w of report.warnings) console.log(`! ${w}`);
    for (const s of report.scenarios) {
      console.log(`${s.pass ? '✓' : '✗'} ${s.name}${s.file ? ` (${s.file})` : ''}${s.steps !== undefined ? ` · ${s.steps} steps` : ''}`);
      for (const f of s.failures || []) console.log(`    - ${f}`);
    }
    console.log(report.ok ? `\nAll good: ${report.passed} scenario(s) passed.` : `\nNot ready: ${report.problems.length} problem(s), ${report.failed} failing scenario(s).`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

if (require.main === module) main();
module.exports = { runScenario, compile };
