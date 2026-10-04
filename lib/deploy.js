// Putting a built project live: GitHub repository + image build, then the
// k3s cluster. Runs as Box (not the build user) because it holds the tokens.
//
// Configuration (from /etc/box.env, written by the deploy workflow):
//   BOX_GITHUB_TOKEN   token that can create private repos and read Actions
//   BOX_KUBECONFIG_FILE  path to a kubeconfig for the cluster (default /etc/box-kubeconfig)
//   BOX_GITHUB_OWNER   repo owner (default ThirunagariHarish)
//   BOX_DOMAIN_SUFFIX  (default cashflowus.com)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run, git, repoDir } = require('./builder');

const OWNER = process.env.BOX_GITHUB_OWNER || 'ThirunagariHarish';
const SUFFIX = process.env.BOX_DOMAIN_SUFFIX || 'cashflowus.com';
const KUBECONFIG = process.env.BOX_KUBECONFIG_FILE || '/etc/box-kubeconfig';
const token = () => process.env.BOX_GITHUB_TOKEN || '';

function configured() {
  return { github: !!token(), kube: fs.existsSync(KUBECONFIG) };
}
function ready() { const c = configured(); return c.github && c.kube; }
function siteUrl(slug) { return `https://${slug}.${SUFFIX}`; }
function repoUrl(slug) { return `https://github.com/${OWNER}/${slug}`; }

async function gh(method, url, body) {
  const r = await fetch(`https://api.github.com${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`, Accept: 'application/vnd.github+json',
      'User-Agent': 'box-build-crew', ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

/** Create the private repo if it doesn't exist. */
async function ensureGithubRepo(slug, description) {
  const exists = await gh('GET', `/repos/${OWNER}/${slug}`);
  if (exists.status === 200) return { created: false, url: repoUrl(slug) };
  const me = await gh('GET', '/user');
  const isMe = me.status === 200 && String(me.data.login).toLowerCase() === OWNER.toLowerCase();
  const body = { name: slug, private: true, description: (description || '').slice(0, 300), has_wiki: false, has_projects: false };
  const r = isMe ? await gh('POST', '/user/repos', body) : await gh('POST', `/orgs/${OWNER}/repos`, body);
  if (r.status === 201) return { created: true, url: repoUrl(slug) };
  if (r.status === 422 && /already exists/i.test(JSON.stringify(r.data))) return { created: false, url: repoUrl(slug) };
  const hint = r.status === 403 || r.status === 404
    ? ' The BOX_GITHUB_TOKEN secret needs to be a classic personal access token with the scopes repo, workflow and read:packages (a fine-grained token cannot create repositories unless it has Administration write on all repositories). Update the secret, redeploy Box, then resume the crew.'
    : '';
  throw new Error(`GitHub would not create the repository ${OWNER}/${slug}: HTTP ${r.status} ${r.data.message || ''}.${hint}`);
}

/** Push main to GitHub. The token goes in via a credential helper, not the URL. */
async function pushRepo(slug) {
  const helper = '!f() { echo "username=x-access-token"; echo "password=$BOX_GH_PUSH_TOKEN"; }; f';
  // As Box, so the token is never in a process the build user owns.
  const r = await git(slug, ['-c', `credential.helper=${helper}`, 'push', '--force', `https://github.com/${OWNER}/${slug}.git`, 'HEAD:main'], {
    env: { BOX_GH_PUSH_TOKEN: token(), GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 5 * 60 * 1000, asBox: true,
  });
  if (r.code !== 0) throw new Error(`git push failed: ${r.out.replace(token(), '***').slice(-800)}`);
  const h = await git(slug, ['rev-parse', 'HEAD']);
  return h.out.trim();
}

/** Wait for the image-build workflow for this commit to succeed. */
async function waitForImage(slug, sha, { onProgress, timeoutMs = 30 * 60 * 1000, stopping } = {}) {
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < timeoutMs) {
    if (stopping && stopping()) throw new Error('__paused__');
    const r = await gh('GET', `/repos/${OWNER}/${slug}/actions/runs?branch=main&per_page=5`);
    const runs = (r.data.workflow_runs || []).filter((w) => w.head_sha === sha);
    const w = runs[0];
    if (w) {
      const s = `${w.status}/${w.conclusion || ''}`;
      if (s !== lastStatus) { lastStatus = s; onProgress?.(`GitHub Actions: ${w.name} is ${w.status}${w.conclusion ? ` (${w.conclusion})` : ''}`); }
      if (w.status === 'completed') {
        if (w.conclusion === 'success') return w.html_url;
        throw Object.assign(new Error(`The image build failed on GitHub Actions (${w.conclusion}). See ${w.html_url}`), { ciRun: { id: w.id, url: w.html_url } });
      }
    }
    await new Promise((res) => setTimeout(res, 20000));
  }
  throw new Error('Timed out waiting for the image build on GitHub Actions.');
}

/**
 * What went wrong in a failed Actions run, as text a developer can act on:
 * the failed steps and the error annotations GitHub attached to them.
 */
async function ciFailure(slug, runId) {
  const out = [];
  const jobs = await gh('GET', `/repos/${OWNER}/${slug}/actions/runs/${runId}/jobs?per_page=20`);
  for (const job of (jobs.data.jobs || []).filter((j) => j.conclusion === 'failure')) {
    const failed = (job.steps || []).filter((s) => s.conclusion === 'failure').map((s) => s.name);
    out.push(`Job "${job.name}" failed${failed.length ? ` at step: ${failed.join(', ')}` : ''}.`);
    const ann = await gh('GET', `/repos/${OWNER}/${slug}/check-runs/${job.id}/annotations`);
    for (const a of (Array.isArray(ann.data) ? ann.data : []).filter((x) => x.annotation_level === 'failure' || x.annotation_level === 'notice')) {
      const where = a.path && a.path !== '.github' ? `${a.path}:${a.start_line} ` : '';
      out.push(`${where}${(a.title ? `${a.title}\n` : '')}${a.message}`.trim());
    }
  }
  return out.join('\n\n').slice(0, 6000) || 'GitHub gave no details; open the run and read the failed step.';
}

function kubectl(args, { input, timeoutMs = 5 * 60 * 1000 } = {}) {
  // As Box: the kubeconfig is root-only and the build user must not reach the cluster.
  return run('kubectl', ['--kubeconfig', KUBECONFIG, ...args], { cwd: process.cwd(), input, timeoutMs, env: { HOME: process.env.HOME || '/root' }, asBox: true });
}

function genSecret(n = 32) { return crypto.randomBytes(n).toString('base64url').slice(0, n); }

/**
 * Values Box can fill in itself when DevOps leaves them for the owner: the
 * owner's email and name, and the site's own address and domain.
 */
function knownValue(slug, name, owner = {}) {
  const url = siteUrl(slug);
  const host = `${slug}.${SUFFIX}`;
  if (/(^|_)(OWNER|ADMIN|SUPPORT|CONTACT|FROM|SENDER|NOTIFY|ALERT)(_|$).*EMAIL|^EMAIL(_FROM|_TO)?$|_EMAIL$/.test(name) && owner.email) return owner.email;
  if (/(^|_)(OWNER|ADMIN)(_|$).*NAME/.test(name) && owner.name) return owner.name;
  // The owner's first sign-in password for the site: generated here and shown to the owner once.
  if (/^(INITIAL_|FIRST_|DEFAULT_|SEED_)?(OWNER|ADMIN)_(INITIAL_)?PASSWORD$/.test(name)) return { value: genSecret(14), reveal: true };
  if (/(APP|BASE|PUBLIC|SITE|WEB|FRONTEND|CLIENT|SERVER|API|CANONICAL|NEXTAUTH|AUTH|BETTER_AUTH)_?URL$|^URL$|^ORIGIN$|^(TRUSTED|ALLOWED|CORS)_ORIGINS?$/.test(name)) return url;
  if (/(^|_)(DOMAIN|HOST|HOSTNAME)$/.test(name) && !/^(DB|DATABASE|PG|POSTGRES|REDIS|SMTP|MAIL)_/.test(name)) return host;
  return null;
}

/** Resolve the DevOps ENV_JSON into concrete values; returns { env, missing, filled }. */
function resolveEnv(slug, envJson, previous = {}, owner = {}) {
  const env = {};
  const missing = [];
  const filled = [];
  const revealed = {};
  const pgPass = previous.__pg || genSecret(24);
  for (const [k, v] of Object.entries(envJson || {})) {
    if (previous[k] && !/GENERATE/.test(String(previous[k]))) { env[k] = previous[k]; continue; }
    if (v === null || v === undefined || v === '') {
      const known = knownValue(slug, k, owner);
      if (known && typeof known === 'object') { env[k] = known.value; filled.push(k); if (known.reveal) revealed[k] = known.value; continue; }
      if (known) { env[k] = known; filled.push(k); continue; }
      missing.push(k); continue;
    }
    let val = String(v);
    if (val === 'GENERATE_32') val = genSecret(32);
    if (val === 'GENERATE_PG') val = pgPass;
    val = val.replace(/GENERATE_PG/g, pgPass).replace(/GENERATE_32/g, genSecret(32));
    env[k] = val;
  }
  env.__pg = pgPass;
  return { env, missing, filled, revealed };
}

function secretManifest(slug, env) {
  const data = Object.entries(env).filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `  ${k}: ${JSON.stringify(String(v))}`).join('\n');
  return `apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${slug}-env\n  namespace: ${slug}\ntype: Opaque\nstringData:\n${data}\n`;
}

/** Apply the project's manifests and wait for the rollout. */
async function applyManifests(slug, env, { onProgress } = {}) {
  const manifest = fs.readFileSync(path.join(repoDir(slug), 'deploy', 'k8s.yaml'), 'utf8');
  // Namespace first so the secrets can land in it.
  let r = await kubectl(['create', 'namespace', slug]);
  if (r.code !== 0 && !/already exists/i.test(r.out)) throw new Error(`kubectl create namespace: ${r.out.slice(-500)}`);
  r = await kubectl(['apply', '-f', '-'], { input: secretManifest(slug, env) });
  if (r.code !== 0) throw new Error(`kubectl apply (env secret): ${r.out.slice(-500)}`);
  // Image pull secret: the project's images are private on GHCR, so the
  // namespace gets a fresh pull secret made from Box's own GitHub token on
  // every deploy (it is always the current token), and the namespace's
  // default service account uses it, so the manifests need not mention it.
  const mk = await kubectl(['create', 'secret', 'docker-registry', 'ghcr-pull', '--docker-server=ghcr.io', `--docker-username=${OWNER}`, `--docker-password=${token()}`, '-n', slug, '--dry-run=client', '-o', 'yaml']);
  if (mk.code === 0) {
    r = await kubectl(['apply', '-f', '-'], { input: mk.out });
    if (r.code !== 0) throw new Error(`kubectl apply (ghcr-pull): ${r.out.slice(-500)}`);
  } else {
    onProgress?.('Could not build the ghcr-pull secret from the GitHub token; the image pull may fail.');
  }
  await kubectl(['patch', 'serviceaccount', 'default', '-n', slug, '-p', '{"imagePullSecrets":[{"name":"ghcr-pull"}]}']);
  r = await kubectl(['apply', '-f', '-'], { input: manifest });
  if (r.code !== 0) throw new Error(`kubectl apply: ${r.out.slice(-800)}`);
  onProgress?.(r.out.trim().split('\n').slice(-6).join('\n'));
  await kubectl(['rollout', 'restart', `deployment/${slug}`, '-n', slug]);
  r = await kubectl(['rollout', 'status', `deployment/${slug}`, '-n', slug, '--timeout=420s'], { timeoutMs: 8 * 60 * 1000 });
  if (r.code !== 0) {
    const pods = await kubectl(['get', 'pods', '-n', slug]);
    // Only warnings from this rollout: the namespace keeps an hour of events
    // and earlier attempts' failures would otherwise be reported again.
    const events = await kubectl(['get', 'events', '-n', slug, '--field-selector', 'type=Warning', '-o', 'json']);
    const since = Date.now() - 12 * 60 * 1000;
    const items = (() => { try { return JSON.parse(events.out).items || []; } catch { return []; } })()
      .filter((e) => new Date(e.lastTimestamp || e.eventTime || e.metadata?.creationTimestamp || 0).getTime() >= since)
      .sort((a, b) => new Date(a.lastTimestamp || 0) - new Date(b.lastTimestamp || 0));
    const warnings = [...new Set(items.map((e) => `${e.reason} ${e.involvedObject?.name || ''}: ${String(e.message || '').replace(/\s+/g, ' ').slice(0, 400)}`))].slice(-8).join('\n');
    const logs = await kubectl(['logs', `deployment/${slug}`, '-n', slug, '--tail=40', '--all-containers']);
    const pull = /ImagePullBackOff|ErrImagePull/.test(pods.out + warnings)
      ? '\n\nThe cluster could not pull a container image (see the warnings above for the image and the registry\'s reason). For the project\'s own image this means the ghcr-pull secret was refused: BOX_GITHUB_TOKEN must be a classic token with read:packages or write:packages.'
      : '';
    throw new Error(`Rollout did not finish: ${r.out.slice(-300)}\n\nPODS:\n${pods.out.slice(-600)}\n\nWARNINGS:\n${warnings.slice(-1500)}\n\nLOGS:\n${logs.out.slice(-1200)}${pull}`);
  }
}

/** Poll the public URL until it answers (TLS certificate takes a minute). */
async function waitForSite(slug, { timeoutMs = 6 * 60 * 1000 } = {}) {
  const url = siteUrl(slug);
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (r.status < 500) return { url, status: r.status };
      last = `HTTP ${r.status}`;
    } catch (e) { last = e.cause?.code || e.message; }
    await new Promise((res) => setTimeout(res, 15000));
  }
  return { url, status: 0, error: last };
}

/** Update the project's env secret in the cluster and restart it. */
async function updateEnv(slug, env) {
  let r = await kubectl(['apply', '-f', '-'], { input: secretManifest(slug, env) });
  if (r.code !== 0) throw new Error(`kubectl apply (env secret): ${r.out.slice(-400)}`);
  r = await kubectl(['rollout', 'restart', `deployment/${slug}`, '-n', slug]);
  if (r.code !== 0) throw new Error(`kubectl rollout restart: ${r.out.slice(-400)}`);
  return true;
}

/** Recent logs from the running app. */
async function logs(slug, lines = 200) {
  const r = await kubectl(['logs', `deployment/${slug}`, '-n', slug, '--tail', String(lines), '--all-containers'], { timeoutMs: 60000 });
  return r.out;
}

/** Take the site offline (scale to 0) or back online (scale to 1). */
async function setOffline(slug, offline) {
  const r = await kubectl(['scale', `deployment/${slug}`, '-n', slug, `--replicas=${offline ? 0 : 1}`]);
  if (r.code !== 0) throw new Error(`kubectl scale: ${r.out.slice(-400)}`);
  return true;
}

module.exports = { configured, ready, siteUrl, repoUrl, ensureGithubRepo, pushRepo, waitForImage, ciFailure, applyManifests, waitForSite, resolveEnv, updateEnv, logs, setOffline, OWNER, KUBECONFIG };
