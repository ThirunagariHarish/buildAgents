// Cloud runs: the Studio runs an agent itself, on its schedule, for owners
// who chose "runs in the cloud" (or whose phone can't wake it).
//
// The agent's code runs in a separate process (lib/kit/cloudrun-child.js) as
// the unprivileged build user, inside bubblewrap with no network at all. Its
// only way out is a line-by-line message channel; every ctx call is checked
// here against the signed manifest before it happens, exactly as the phone's
// Runtime does.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { DATA } = require('./config');
const ws = require('./workspace');
const packages = require('./packages');
const settings = require('./settings');
const devices = require('./devices');
const { deliver } = require('./deliver');
const { sandboxArgs, askClaude } = require('./claude');
const { allowedHosts } = require('./kit/core');

const CHILD = path.join(__dirname, 'kit', 'cloudrun-child.js');
const MEM_DIR = path.join(DATA, 'cloud-memory');
const RUN_TIMEOUT_MS = 90 * 1000;
const CLOUD_DEVICE = { id: 'cloud', name: 'Cloud' };
const running = new Set();
fs.mkdirSync(MEM_DIR, { recursive: true, mode: 0o700 });

const memFile = (id) => path.join(MEM_DIR, `${id}.json`);
const readMem = (id) => { try { return JSON.parse(fs.readFileSync(memFile(id), 'utf8')); } catch { return {}; } };
const PERM_OF = { memoryGet: 'memory', memorySet: 'memory', notify: 'notify', httpGet: 'http', location: 'location', model: 'model', handoff: 'handoff' };

function childProcess() {
  const u = ws.buildUser();
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: u ? u.home : process.env.HOME };
  if (u && process.env.PB_BWRAP === '1') {
    const cwd = path.join(ws.WORK_DIR, '_cloud');
    fs.mkdirSync(cwd, { recursive: true });
    try { fs.chownSync(cwd, u.uid, u.gid); } catch {}
    const args = [...sandboxArgs(cwd, u.home), '--unshare-net', '--', process.execPath, CHILD];
    return spawn('bwrap', args, { env, uid: u.uid, gid: u.gid, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  return spawn(process.execPath, [CHILD], { env, ...(u ? { uid: u.uid, gid: u.gid } : {}), stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Run an agent once in the cloud. Returns the recorded run, or null when it
 * could not run (not released, switched off, missing settings, already running).
 */
async function run(agent, trigger, { onRun } = {}) {
  const rec = packages.load(agent.id);
  if (!rec || rec.channel === 'off' || running.has(agent.id)) return null;
  const m = rec.package.manifest;
  const values = settings.values(agent.id);
  if (settings.missing(agent.id, m).length) return null;
  running.add(agent.id);
  const perms = new Set(m.permissions || []);
  const allow = allowedHosts(m, values);
  const maxSteps = Number((m.budget && m.budget.steps) || 30);
  const record = { notifications: [], log: [], steps: 0, handoffs: 0, httpReads: 0 };
  const live = rec.channel === 'live';

  const tools = {
    async memoryGet(k) { return readMem(agent.id)[String(k)] ?? null; },
    async memorySet(k, v) {
      const mem = readMem(agent.id);
      if (v === null) delete mem[String(k)]; else mem[String(k)] = v;
      if (JSON.stringify(mem).length > 200000) throw new Error('This agent\'s memory is over 200 KB.');
      fs.writeFileSync(memFile(agent.id), JSON.stringify(mem), { mode: 0o600 });
      return true;
    },
    async notify(n) { record.notifications.push({ title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 1200) }); return true; },
    async httpGet(url) {
      const u = new URL(String(url));
      if (u.protocol !== 'https:' || !allow.has(u.hostname.toLowerCase())) throw new Error(`${u.hostname} is not an address this agent may read.`);
      record.httpReads += 1;
      return devices.httpGet(m, u.toString(), values);
    },
    async location() { return null; },
    async model(prompt, opts) {
      if (!devices.takeHandoff(agent.ownerId)) return null;
      try { return (await askClaude({ model: 'haiku', timeoutMs: 60000, system: `Answer briefly and directly, at most ${Number((opts && opts.maxWords) || 150)} words, plain text.`, prompt: String(prompt).slice(0, 8000) })).text.trim(); } catch { return null; }
    },
    async handoff(prompt) {
      record.handoffs += 1;
      if (!devices.takeHandoff(agent.ownerId)) return null;
      try { return (await askClaude({ model: 'sonnet', timeoutMs: 3 * 60000, system: `You answer one request from "${agent.title}", a personal agent. Answer directly and briefly in plain text.`, prompt: String(prompt).slice(0, 8000) })).text.trim(); } catch { return null; }
    },
  };

  const result = await new Promise((resolve) => {
    let child;
    try { child = childProcess(); } catch (e) { resolve({ ok: false, error: `Could not start the cloud runner: ${e.message}` }); return; }
    let finished = false;
    const finish = (r) => { if (finished) return; finished = true; clearTimeout(timer); try { child.kill('SIGKILL'); } catch {} resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, error: `Stopped after ${RUN_TIMEOUT_MS / 1000} s.` }), RUN_TIMEOUT_MS);
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish({ ok: false, error: `The cloud runner failed: ${e.message}` }));
    child.on('close', () => finish({ ok: false, error: `The cloud runner stopped early. ${stderr.slice(-300)}` }));
    const send = (msg) => { try { child.stdin.write(`${JSON.stringify(msg)}\n`); } catch {} };
    readline.createInterface({ input: child.stdout }).on('line', async (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.type === 'log') { record.log.push(String(msg.line).slice(0, 300)); return; }
      if (msg.type === 'done') { finish(msg); return; }
      if (msg.type !== 'call') return;
      const perm = PERM_OF[msg.fn];
      if (!perm || !perms.has(perm)) return send({ type: 'reply', id: msg.id, ok: false, error: `Not allowed: ${msg.fn}.` });
      record.steps += 1;
      if (record.steps > maxSteps) { send({ type: 'reply', id: msg.id, ok: false, error: 'Step budget exceeded.' }); return finish({ ok: false, error: `Step budget exceeded: more than ${maxSteps} ctx calls in one run.` }); }
      try { send({ type: 'reply', id: msg.id, ok: true, value: (await tools[msg.fn](...(msg.args || []))) ?? null }); }
      catch (e) { send({ type: 'reply', id: msg.id, ok: false, error: e.message }); }
    });
    const tz = require('./prefs').get(agent.ownerId).tz || (devices.list(agent.ownerId)[0] || {}).tz || 'UTC';
    send({ type: 'run', manifest: m, code: rec.package.code, trigger, settings: values, tz });
  });

  running.delete(agent.id);
  const runRec = devices.recordRun(CLOUD_DEVICE, agent.id, {
    version: m.version, channel: live ? 'live' : 'shadow', trigger: trigger.type, ok: !!result.ok, error: result.ok ? null : result.error,
    steps: record.steps, durationMs: result.durationMs || 0, notifications: record.notifications, log: record.log,
    handoffs: record.handoffs, httpReads: record.httpReads,
  });
  const delivered = await deliver(agent, record.notifications, { channel: live ? 'live' : 'shadow' });
  if (onRun) onRun(runRec, delivered);
  return runRec;
}

const isRunning = (id) => running.has(id);
module.exports = { run, isRunning };
