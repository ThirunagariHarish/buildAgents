// The build sandbox: where project code lives and who runs it.
//
// Build-crew agents (developers, QA, DevOps) get real tools — a shell, file
// edits — so they run as the unprivileged `boxbuild` user when Box itself is
// root (the VPS). That user owns only data/work/<slug>/repo, cannot read
// Box's ideas or /etc/box.env, and the shell tool is further limited to
// build commands (see BUILD_TOOLS). Locally, without that user, everything
// runs as the current user.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WORK_DIR = path.join(__dirname, '..', 'data', 'work');
const BUILD_USER = process.env.BOX_BUILD_USER || 'boxbuild';

/** Tools the developers may use. Shell access is limited to build commands. */
const BUILD_TOOLS = [
  'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'Bash(npm:*)', 'Bash(pnpm:*)', 'Bash(npx:*)', 'Bash(corepack:*)', 'Bash(node:*)', 'Bash(tsc:*)',
  'Bash(python3:*)', 'Bash(python:*)', 'Bash(uv:*)', 'Bash(pip:*)', 'Bash(pytest:*)', 'Bash(ruff:*)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git ls-files:*)', 'Bash(git show:*)',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(find:*)', 'Bash(tree:*)',
  'Bash(mkdir:*)', 'Bash(touch:*)', 'Bash(cp:*)', 'Bash(mv:*)', 'Bash(rm:*)', 'Bash(chmod:*)',
  'Bash(timeout:*)', 'Bash(curl:*)', 'Bash(sleep:*)', 'Bash(kill:*)', 'Bash(pkill:*)', 'Bash(echo:*)', 'Bash(printf:*)',
  'Bash(docker build:*)', 'Bash(env:*)', 'Bash(which:*)',
  'Bash(psql:*)', 'Bash(createdb:*)', 'Bash(dropdb:*)', 'Bash(pg_dump:*)', 'Bash(redis-cli:*)',
];
/** Read-only tools for reviewers (QA, Design QA) plus running the checks. */
const REVIEW_TOOLS = [
  'Read', 'Glob', 'Grep',
  'Bash(npm:*)', 'Bash(pnpm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(python3:*)', 'Bash(uv:*)', 'Bash(pytest:*)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git ls-files:*)',
  'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(find:*)',
  'Bash(timeout:*)', 'Bash(curl:*)', 'Bash(sleep:*)', 'Bash(kill:*)', 'Bash(pkill:*)',
  'Bash(psql:*)', 'Bash(createdb:*)', 'Bash(redis-cli:*)',
];

/**
 * Each project gets its own Postgres role and database with a random
 * password, so one project's agents cannot reach another project's data.
 * Falls back to the shared sandbox role when Postgres is not available.
 */
const dbCreds = new Map();
async function projectDb(slug) {
  if (dbCreds.has(slug)) return dbCreds.get(slug);
  const name = `p_${slug.replace(/-/g, '_').slice(0, 40)}`;
  const credFile = path.join(WORK_DIR, slug, '.db.json');
  let cred = null;
  try { cred = JSON.parse(fs.readFileSync(credFile, 'utf8')); } catch {}
  if (!cred) {
    const password = require('crypto').randomBytes(18).toString('base64url');
    const sql = `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${name}') THEN CREATE ROLE ${name} LOGIN PASSWORD '${password}'; ELSE ALTER ROLE ${name} PASSWORD '${password}'; END IF; END $$;`;
    const asPostgres = (args, input) => new Promise((resolve) => {
      const c = spawn('sudo', ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
      c.on('error', () => resolve({ code: 127, out })); c.on('close', (code) => resolve({ code, out }));
      if (input) c.stdin.write(input); c.stdin.end();
    });
    const r1 = await asPostgres(['-d', 'postgres'], sql);
    if (r1.code === 0) {
      const r2 = await asPostgres(['-d', 'postgres', '-tAc', `SELECT 1 FROM pg_database WHERE datname='${name}'`]);
      if (!/1/.test(r2.out)) await asPostgres(['-d', 'postgres'], `CREATE DATABASE ${name} OWNER ${name}; REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC;`);
      else await asPostgres(['-d', 'postgres'], `REVOKE CONNECT ON DATABASE ${name} FROM PUBLIC;`);
      cred = { user: name, password, db: name };
      try { fs.mkdirSync(path.dirname(credFile), { recursive: true }); fs.writeFileSync(credFile, JSON.stringify(cred), { mode: 0o600 }); } catch {}
    } else {
      cred = { user: 'boxbuild', password: 'boxbuild', db: `${slug.replace(/-/g, '_')}_dev`, shared: true };
    }
  }
  dbCreds.set(slug, cred);
  return cred;
}

/** Local services the sandbox offers, described to the crew. */
function servicesText(slug) {
  const c = dbCreds.get(slug) || { user: 'boxbuild', password: 'boxbuild', db: `${slug.replace(/-/g, '_')}_dev`, shared: true };
  const url = `postgresql://${c.user}:${c.password}@127.0.0.1:5432/${c.db}`;
  return `LOCAL SERVICES IN THIS SANDBOX: a Postgres database for this project only — DATABASE_URL=${url} (role and database already exist${c.shared ? `; create the database with \`PGPASSWORD=${c.password} createdb -h 127.0.0.1 -U ${c.user} ${c.db}\` if missing` : ''}). Redis on localhost:6379. Use them for migrations and tests; put the variable names (not values) in .env.example. Never assume Docker is available for services. You cannot see other projects; stay inside this repository.`;
}

let runAsCache;
/** The unprivileged build user, or null to run as ourselves. */
function buildUser() {
  if (runAsCache !== undefined) return runAsCache;
  runAsCache = null;
  try {
    if (process.getuid && process.getuid() === 0 && !process.env.BOX_NO_BUILD_USER) {
      const line = fs.readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.startsWith(`${BUILD_USER}:`));
      if (line) {
        const [name, , uid, gid, , home] = line.split(':');
        runAsCache = { name, uid: Number(uid), gid: Number(gid), home };
      }
    }
  } catch {}
  return runAsCache;
}

function repoDir(slug) {
  return path.join(WORK_DIR, slug, 'repo');
}

/**
 * Run a command in the repo as the build user; resolves { code, out }.
 * `asBox: true` runs it as Box itself instead: for steps that hold Box's
 * credentials (the cluster kubeconfig, the GitHub token), which the build
 * user must not be able to read.
 */
function run(cmd, args, { cwd, env = {}, timeoutMs = 10 * 60 * 1000, input, asBox = false } = {}) {
  return new Promise((resolve) => {
    const u = asBox ? null : buildUser();
    const opts = { cwd, env: { ...process.env, ...env } };
    delete opts.env.BOX_PASSWORD;
    if (!asBox) { delete opts.env.BOX_GITHUB_TOKEN; delete opts.env.CLAUDE_CODE_OAUTH_TOKEN; }
    if (u) { opts.uid = u.uid; opts.gid = u.gid; opts.env.HOME = u.home; opts.env.USER = u.name; }
    let out = '';
    let child;
    try { child = spawn(cmd, args, opts); } catch (e) { return resolve({ code: 127, out: e.message }); }
    const timer = setTimeout(() => { child.kill('SIGKILL'); out += '\n[timed out]'; }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 127, out: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.slice(-20000) }); });
    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function git(slug, args, opts = {}) {
  return run('git', ['-c', 'safe.directory=*', ...args], { cwd: repoDir(slug), ...opts });
}

/** Create the project's repo directory (owned by the build user) with an initial commit. */
async function ensureRepo(slug, { readme } = {}) {
  const dir = repoDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const u = buildUser();
  if (u) {
    // The work tree belongs to the build user; data/work itself stays ours.
    for (const p of [path.join(WORK_DIR, slug), dir]) {
      try { fs.chownSync(p, u.uid, u.gid); } catch {}
    }
  }
  await projectDb(slug).catch(() => {});
  if (!fs.existsSync(path.join(dir, '.git'))) {
    await git(slug, ['init', '-q', '-b', 'main']);
    await git(slug, ['config', 'user.name', 'Box build crew']);
    await git(slug, ['config', 'user.email', 'box@cashflowus.com']);
    if (readme) {
      fs.writeFileSync(path.join(dir, 'README.md'), readme);
      if (u) fs.chownSync(path.join(dir, 'README.md'), u.uid, u.gid);
    }
    await git(slug, ['add', '-A']);
    await git(slug, ['commit', '-q', '-m', 'Project created by Box', '--allow-empty']);
  }
  return dir;
}

/** Commit everything with a message; returns the short hash or null if nothing changed. */
async function commitAll(slug, message) {
  await git(slug, ['add', '-A']);
  const st = await git(slug, ['status', '--porcelain']);
  if (!st.out.trim()) return null;
  const r = await git(slug, ['commit', '-q', '-m', message]);
  if (r.code !== 0) return null;
  const h = await git(slug, ['rev-parse', '--short', 'HEAD']);
  return h.out.trim() || null;
}

/** A compact tree of the repo for prompts (tracked + untracked, no deps). */
async function fileTree(slug, limit = 400) {
  const r = await git(slug, ['ls-files', '--cached', '--others', '--exclude-standard']);
  const files = r.out.split('\n').filter(Boolean).filter((f) => !/(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__|\.venv)\//.test(f));
  return files.length > limit ? `${files.slice(0, limit).join('\n')}\n… and ${files.length - limit} more` : files.join('\n');
}

async function recentCommits(slug, n = 15) {
  const r = await git(slug, ['log', '--oneline', `-${n}`]);
  return r.out.trim();
}

/** Write a file into the repo on the crew's behalf (owned by the build user). */
function writeRepoFile(slug, rel, content) {
  const file = path.join(repoDir(slug), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const u = buildUser();
  if (u) {
    try { fs.chownSync(path.dirname(file), u.uid, u.gid); fs.chownSync(file, u.uid, u.gid); } catch {}
  }
}

function readRepoFile(slug, rel) {
  try { return fs.readFileSync(path.join(repoDir(slug), rel), 'utf8'); } catch { return null; }
}

module.exports = { WORK_DIR, BUILD_TOOLS, REVIEW_TOOLS, servicesText, projectDb, buildUser, repoDir, run, git, ensureRepo, commitAll, fileTree, recentCommits, writeRepoFile, readRepoFile, os };
