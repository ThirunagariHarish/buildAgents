// The Python sidecar with Hugging Face models (models/sidecar.py). It is
// optional: the deploy installs it when the server has room, and writes
// data/models-ready once a check call works. Without it the desk falls back
// to the word list and the bootstrap simulation alone.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA, ROOT, PYTHON } = require('./config');

const READY = path.join(DATA, 'models-ready');
const SCRIPT = path.join(ROOT, 'models', 'sidecar.py');

async function available() {
  return fs.existsSync(PYTHON) && fs.existsSync(READY);
}
function info() {
  try { return JSON.parse(fs.readFileSync(READY, 'utf8')); } catch { return null; }
}

// One model process at a time: they are memory-heavy.
let chain = Promise.resolve();
function call(mode, payload, timeoutMs = 240000) {
  const run = () => new Promise((resolve, reject) => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME || '/root', HF_HOME: path.join(DATA, 'hf'), LANG: 'C.UTF-8' };
    const child = spawn(PYTHON, [SCRIPT], { env });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('model timed out')); }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(t); reject(e); });
    child.on('close', (code) => {
      clearTimeout(t);
      try { const j = JSON.parse(out); if (j.error) throw new Error(j.error); return resolve(j); } catch (e) { reject(new Error(`model ${mode} failed (exit ${code}): ${(err || e.message).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`)); }
    });
    child.stdin.end(JSON.stringify({ mode, ...payload }));
  });
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

module.exports = { available, call, info, READY };
