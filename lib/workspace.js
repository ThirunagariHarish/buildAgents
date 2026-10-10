// Where each agent's code lives, and who may touch it.
//
// Every agent gets its own git repository under data/work/<id>/repo, owned by
// the unprivileged build user (boxbuild on the server). The crew's Claude Code
// turns and the eval runs execute as that user, inside the bubblewrap sandbox
// when PB_BWRAP=1: a read-only system, Pocket Box's data hidden, only this
// repository writable. The agent kit is copied in as agentkit/.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { DATA } = require('./config');
const { sandboxArgs } = require('./claude');

const WORK_DIR = path.join(DATA, 'work');
const KIT_DIR = path.join(__dirname, 'kit');
const BUILD_USER = process.env.PB_BUILD_USER || 'boxbuild';

/** The crew's tools: files, node for the evals, a few read-only shell commands. */
const DEV_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)'];
const REVIEW_TOOLS = ['Read', 'Write', 'Glob', 'Grep', 'Bash(node:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(git diff:*)', 'Bash(git log:*)'];

let runAsCache;
function buildUser() {
  if (runAsCache !== undefined) return runAsCache;
  runAsCache = null;
  try {
    if (process.getuid && process.getuid() === 0 && !process.env.PB_NO_BUILD_USER) {
      const line = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.startsWith(`${BUILD_USER}:`));
      if (line) { const [name, , uid, gid, , home] = line.split(':'); runAsCache = { name, uid: Number(uid), gid: Number(gid), home }; }
    }
  } catch {}
  return runAsCache;
}

function repoDir(id) { return path.join(WORK_DIR, id, 'repo'); }

/** Run a command in an agent's repo as the build user (sandboxed when enabled). */
function run(cmd, args, { cwd, timeoutMs = 5 * 60 * 1000, sandbox = false, env = {} } = {}) {
  return new Promise((resolve) => {
    const u = buildUser();
    const base = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: u ? u.home : process.env.HOME, ...env };
    const opts = { cwd, env: base };
    if (u) { opts.uid = u.uid; opts.gid = u.gid; base.USER = u.name; }
    let bin = cmd, argv = args;
    if (sandbox && u && process.env.PB_BWRAP === '1') { bin = 'bwrap'; argv = [...sandboxArgs(cwd, u.home), '--', cmd, ...args]; }
    let out = '', child;
    try { child = spawn(bin, argv, opts); } catch (e) { return resolve({ code: 127, out: e.message }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); out += '\n[timed out]'; }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.slice(-200000) }); });
    child.stdin.end();
  });
}

function git(id, args, opts = {}) { return run('git', ['-c', 'safe.directory=*', ...args], { cwd: repoDir(id), ...opts }); }

function chownTree(p) {
  const u = buildUser();
  if (!u) return;
  try { fs.chownSync(p, u.uid, u.gid); } catch {}
}

/** (Re)copy the agent kit into the repo: the contract, validator and eval runner. */
function installKit(id) {
  const dir = path.join(repoDir(id), 'agentkit');
  fs.mkdirSync(dir, { recursive: true });
  chownTree(dir);
  for (const f of ['core.js', 'evals.js', 'CONTRACT.md']) {
    const to = path.join(dir, f);
    fs.copyFileSync(path.join(KIT_DIR, f), to);
    chownTree(to);
  }
}

async function ensureRepo(id, { readme } = {}) {
  const dir = repoDir(id);
  fs.mkdirSync(dir, { recursive: true });
  chownTree(path.join(WORK_DIR, id));
  chownTree(dir);
  installKit(id);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    await git(id, ['init', '-q', '-b', 'main']);
    await git(id, ['config', 'user.name', 'Pocket Box crew']);
    await git(id, ['config', 'user.email', 'agents@cashflowus.com']);
    if (readme) { fs.writeFileSync(path.join(dir, 'README.md'), readme); chownTree(path.join(dir, 'README.md')); }
    fs.mkdirSync(path.join(dir, 'evals'), { recursive: true });
    chownTree(path.join(dir, 'evals'));
    await git(id, ['add', '-A']);
    await git(id, ['commit', '-q', '-m', 'Agent created by Pocket Box', '--allow-empty']);
  }
  return dir;
}

async function commitAll(id, message) {
  await git(id, ['add', '-A']);
  const st = await git(id, ['status', '--porcelain']);
  if (!st.out.trim()) return null;
  const r = await git(id, ['commit', '-q', '-m', message]);
  if (r.code !== 0) return null;
  return (await git(id, ['rev-parse', '--short', 'HEAD'])).out.trim() || null;
}

async function head(id) { return (await git(id, ['rev-parse', '--short', 'HEAD'])).out.trim(); }

function readFile(id, rel) {
  const p = path.join(repoDir(id), path.normalize(rel));
  if (!p.startsWith(repoDir(id))) return null;
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function listFiles(id) {
  const out = [];
  const root = repoDir(id);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(path.relative(root, p));
    }
  };
  try { walk(root); } catch {}
  return out.sort();
}

/** The kit's verdict on the repo as it stands: { ok, problems, warnings, scenarios, passed, failed }. */
async function runEvals(id) {
  installKit(id);
  const r = await run(process.execPath, ['agentkit/evals.js', '--json'], { cwd: repoDir(id), sandbox: true, timeoutMs: 3 * 60 * 1000 });
  try { return JSON.parse(r.out.slice(r.out.indexOf('{'))); } catch { return { ok: false, problems: [`The eval runner did not finish: ${r.out.slice(-600)}`], warnings: [], scenarios: [], passed: 0, failed: 0 }; }
}

module.exports = { WORK_DIR, DEV_TOOLS, REVIEW_TOOLS, buildUser, repoDir, run, git, ensureRepo, installKit, commitAll, head, readFile, listFiles, runEvals };
