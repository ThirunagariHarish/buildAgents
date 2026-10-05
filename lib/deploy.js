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

/**
 * Push main to GitHub. The token goes in via a credential helper, not the URL.
 * Returns { sha, pushed }: pushed is false when GitHub already had this
 * commit (a resumed deploy), so nothing is rebuilt needlessly.
 */
async function pushRepo(slug) {
  const helper = '!f() { echo "username=x-access-token"; echo "password=$BOX_GH_PUSH_TOKEN"; }; f';
  const env = { BOX_GH_PUSH_TOKEN: token(), GIT_TERMINAL_PROMPT: '0' };
  const h = await git(slug, ['rev-parse', 'HEAD']);
  const sha = h.out.trim();
  const remote = await git(slug, ['-c', `credential.helper=${helper}`, 'ls-remote', `https://github.com/${OWNER}/${slug}.git`, 'refs/heads/main'], { env, timeoutMs: 60 * 1000, asBox: true });
  if (remote.code === 0 && remote.out.trim().startsWith(sha)) return { sha, pushed: false };
  // As Box, so the token is never in a process the build user owns.
  const r = await git(slug, ['-c', `credential.helper=${helper}`, 'push', '--force', `https://github.com/${OWNER}/${slug}.git`, 'HEAD:main'], {
    env, timeoutMs: 5 * 60 * 1000, asBox: true,
  });
  if (r.code !== 0) throw new Error(`git push failed: ${r.out.replace(token(), '***').slice(-800)}`);
  return { sha, pushed: true };
}

/** Wait for the image-build workflow for this commit to succeed. */
async function waitForImage(slug, sha, { onProgress, timeoutMs = 30 * 60 * 1000, stopping } = {}) {
  const started = Date.now();
  let lastStatus = '';
  while (Date.now() - started < timeoutMs) {
    if (stopping && stopping()) throw new Error('__paused__');
    const r = await gh('GET', `/repos/${OWNER}/${slug}/actions/runs?branch=main&per_page=10`);
    // A repository may run several workflows for one commit (checks, image
    // build). Every one of them must pass; the first failure goes back to
    // the developer, and the image workflow's run is what we report.
    const runs = (r.data.workflow_runs || []).filter((w) => w.head_sha === sha && w.event === 'push');
    if (runs.length) {
      const s = runs.map((w) => `${w.name}:${w.status}/${w.conclusion || ''}`).join(' ');
      if (s !== lastStatus) { lastStatus = s; onProgress?.(`GitHub Actions: ${runs.map((w) => `${w.name} ${w.conclusion || w.status}`).join(', ')}`); }
      // Only the workflow that publishes the image gates the deploy. Box's
      // own QA and code review already gate quality; the repository's other
      // checks (lint, e2e on a GitHub runner) are reported, and handed to a
      // developer as a task, but never hold a verified build hostage.
      const image = runs.find((w) => /image|build|docker|publish|release/i.test(w.name)) || (runs.length === 1 ? runs[0] : null);
      if (image && image.status === 'completed') {
        if (image.conclusion !== 'success' && image.conclusion !== 'skipped') {
          throw Object.assign(new Error(`The image build failed on GitHub Actions (${image.name}: ${image.conclusion}). See ${image.html_url}`), { ciRun: { id: image.id, url: image.html_url } });
        }
        const otherFailures = runs.filter((w) => w.id !== image.id && w.status === 'completed' && w.conclusion !== 'success' && w.conclusion !== 'skipped')
          .map((w) => ({ id: w.id, name: w.name, url: w.html_url }));
        return { url: image.html_url, otherFailures };
      }
      if (!image && runs.every((w) => w.status === 'completed')) {
        // No workflow looks like the image build; if everything passed, go on.
        const failed = runs.find((w) => w.conclusion !== 'success' && w.conclusion !== 'skipped');
        if (failed) throw Object.assign(new Error(`The image build failed on GitHub Actions (${failed.name}: ${failed.conclusion}). See ${failed.html_url}`), { ciRun: { id: failed.id, url: failed.html_url } });
        return { url: runs[0].html_url, otherFailures: [] };
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
    const useful = (x) => x.annotation_level === 'failure'
      || (x.annotation_level === 'notice' && /fail|error|✘|passed|expect/i.test(x.message || '') && !/ubuntu-latest|Node\.js \d+ is deprecated/.test(x.message || ''));
    for (const a of (Array.isArray(ann.data) ? ann.data : []).filter(useful)) {
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
async function applyManifests(slug, env, { onProgress, customDomain } = {}) {
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
  // Some fields can never be edited in place (a StatefulSet's volume claims,
  // a Service's cluster IP or type, a Job's template). When the crew changed
  // one, recreate that resource and apply again. A StatefulSet is deleted
  // with --cascade=orphan so its pods and volumes survive and the new one
  // adopts them; volumes themselves are never deleted.
  for (let round = 0; round < 4 && r.code !== 0; round++) {
    const fixes = [];
    for (const m of r.out.matchAll(/StatefulSet\.apps "([^"]+)" is invalid: [^\n]*forbidden/g)) fixes.push({ kind: 'statefulset', name: m[1], orphan: true });
    for (const m of r.out.matchAll(/The (Service|Job|Ingress|Deployment|CronJob) "([^"]+)" is invalid: [^\n]*(may not change once set|immutable|Forbidden)/g)) fixes.push({ kind: m[1].toLowerCase(), name: m[2] });
    for (const m of r.out.matchAll(/(Service|Job|Ingress|Deployment|CronJob)(?:\.[a-z.]+)? "([^"]+)" is invalid: [^\n]*(may not change once set|immutable|Forbidden)/g)) fixes.push({ kind: m[1].toLowerCase(), name: m[2] });
    const unique = [...new Map(fixes.map((f) => [`${f.kind}/${f.name}`, f])).values()];
    if (!unique.length) break;
    for (const f of unique) {
      onProgress?.(`Recreating ${f.kind} ${f.name}: it changed in a field Kubernetes cannot edit in place${f.orphan ? ' (pods and data are kept)' : ''}`);
      await kubectl(['delete', f.kind, f.name, '-n', slug, '--ignore-not-found', ...(f.orphan ? ['--cascade=orphan'] : [])]);
    }
    r = await kubectl(['apply', '-f', '-'], { input: manifest });
  }
  if (r.code !== 0) throw new Error(`kubectl apply: ${r.out.slice(-800)}`);
  onProgress?.(r.out.trim().split('\n').slice(-6).join('\n'));
  // The owner's custom domain lives on the Ingress regardless of what the
  // crew's manifests say; the manifests were just applied, so (re)add it.
  if (customDomain !== undefined) {
    try { await applyCustomDomain(slug, customDomain); if (customDomain) onProgress?.(`Custom domain ${customDomain} is on the site's Ingress`); } catch (e) { onProgress?.(`Custom domain not applied: ${e.message}`); }
  }
  await kubectl(['rollout', 'restart', `deployment/${slug}`, '-n', slug]);
  r = await kubectl(['rollout', 'status', `deployment/${slug}`, '-n', slug, '--timeout=420s'], { timeoutMs: 8 * 60 * 1000 });
  if (r.code !== 0) {
    // A recreated StatefulSet cannot update a pod it adopted when the new
    // template changes fields a running pod may not change. Replace that pod:
    // the StatefulSet makes a new one on the same volume, so data is kept.
    const ev = await kubectl(['get', 'events', '-n', slug, '--field-selector', 'reason=FailedUpdate', '-o', 'json']);
    const stuck = (() => { try { return JSON.parse(ev.out).items || []; } catch { return []; } })()
      .filter((e) => /pod updates may not change fields/.test(e.message || '') && Date.now() - new Date(e.lastTimestamp || 0).getTime() < 15 * 60 * 1000)
      .map((e) => (e.message.match(/Pod "([^"]+)" is invalid/) || [])[1]).filter(Boolean);
    for (const pod of [...new Set(stuck)]) {
      onProgress?.(`Replacing pod ${pod}: its StatefulSet changed in a way a running pod cannot take; the volume and its data are kept`);
      await kubectl(['delete', 'pod', pod, '-n', slug, '--ignore-not-found', '--wait=false']);
    }
    if (stuck.length) {
      onProgress?.('Waiting for the database to come back, then for the app');
      await kubectl(['rollout', 'status', `statefulset`, '-n', slug, '--timeout=300s'], { timeoutMs: 6 * 60 * 1000 });
      await kubectl(['rollout', 'restart', `deployment/${slug}`, '-n', slug]);
      r = await kubectl(['rollout', 'status', `deployment/${slug}`, '-n', slug, '--timeout=420s'], { timeoutMs: 8 * 60 * 1000 });
    }
  }
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
    // Where things run and whether services have anyone behind them: the
    // usual answer to "the app cannot reach the database".
    const wide = await kubectl(['get', 'pods', '-n', slug, '-o', 'wide', '--no-headers']);
    const endpoints = await kubectl(['get', 'endpoints', '-n', slug, '--no-headers']);
    const pending = pods.out.split('\n').filter((l) => /Init:|PodInitializing/.test(l)).map((l) => l.split(/\s+/)[0]);
    let initLogs = '';
    for (const pod of pending.slice(0, 2)) {
      const l = await kubectl(['logs', pod, '-n', slug, '--all-containers', '--tail=8'], { timeoutMs: 30000 });
      initLogs += `\n${pod} (init containers):\n${l.out.slice(-600)}`;
    }
    const pull = /ImagePullBackOff|ErrImagePull/.test(pods.out + warnings)
      ? '\n\nThe cluster could not pull a container image (see the warnings above for the image and the registry\'s reason). For the project\'s own image this means the ghcr-pull secret was refused: BOX_GITHUB_TOKEN must be a classic token with read:packages or write:packages.'
      : '';
    throw new Error(`Rollout did not finish: ${r.out.slice(-300)}\n\nPODS (with node):\n${wide.out.slice(-700)}\n\nSERVICE ENDPOINTS:\n${endpoints.out.slice(-400)}\n\nWARNINGS:\n${warnings.slice(-1500)}\n\nLOGS:\n${logs.out.slice(-1000)}${initLogs}${pull}`);
  }
}

/**
 * Put the owner's custom domain on the site's Ingress ourselves, instead of
 * relying on the crew's manifests: a host rule cloned from the main host and
 * a TLS entry (cert-manager issues the certificate through the Ingress's
 * issuer annotation). A previous custom domain is removed. Re-run after each
 * manifest apply, because the repository's manifests do not know about it.
 */
async function applyCustomDomain(slug, domain) {
  const main = `${slug}.${SUFFIX}`;
  const r = await kubectl(['get', 'ingress', '-n', slug, '-o', 'json']);
  if (r.code !== 0) throw new Error(`kubectl get ingress: ${r.out.slice(-300)}`);
  const items = (() => { try { return JSON.parse(r.out).items || []; } catch { return []; } })();
  const ing = items.find((i) => (i.spec?.rules || []).some((x) => x.host === main)) || items[0];
  if (!ing) throw new Error('The site has no Ingress yet.');
  const ANN = 'box.cashflowus.com/custom-domain';
  const prev = ing.metadata.annotations?.[ANN] || null;
  const base = (ing.spec.rules || []).find((x) => x.host === main) || ing.spec.rules?.[0];
  if (!base) throw new Error('The Ingress has no host rule to copy.');
  let rules = (ing.spec.rules || []).filter((x) => x.host !== prev || x.host === main);
  let tls = (ing.spec.tls || []).filter((t) => !(t.hosts || []).includes(prev) || (t.hosts || []).includes(main));
  if (domain && domain !== main) {
    if (!rules.some((x) => x.host === domain)) rules.push({ host: domain, http: base.http });
    if (!tls.some((t) => (t.hosts || []).includes(domain))) tls.push({ hosts: [domain], secretName: `${slug}-custom-tls` });
  }
  const out = {
    apiVersion: ing.apiVersion || 'networking.k8s.io/v1', kind: 'Ingress',
    metadata: { name: ing.metadata.name, namespace: slug, annotations: { ...(ing.metadata.annotations || {}), [ANN]: domain || '' }, labels: ing.metadata.labels },
    spec: { ...ing.spec, rules, tls },
  };
  delete out.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration'];
  const a = await kubectl(['apply', '-f', '-'], { input: JSON.stringify(out) });
  if (a.code !== 0) throw new Error(`kubectl apply (ingress): ${a.out.slice(-400)}`);
  return { hosts: rules.map((x) => x.host) };
}

/**
 * Is this HTTP answer a working site? A page or a redirect is; so is a
 * sign-in gate (401/403). A 404 is not: the router's plain "404 page not
 * found" means no site is registered for the hostname, and an app that
 * cannot serve its front page is not live either.
 */
function healthy(status) {
  return (status >= 200 && status < 400) || status === 401 || status === 403;
}

/** One probe of a URL: { up, status, error, router } (router: the cluster router answered, not the app). */
async function probeSite(url) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const body = r.status === 404 ? (await r.text().catch(() => '')).slice(0, 80) : '';
    const router = r.status === 404 && /^404 page not found\s*$/.test(body);
    return { up: healthy(r.status), status: r.status, router, error: healthy(r.status) ? undefined : router ? 'HTTP 404 from the cluster router: no site is registered for this hostname' : `HTTP ${r.status}` };
  } catch (e) { return { up: false, status: 0, error: e.cause?.code || e.message }; }
}

/** Poll the public URL until it answers with a working page (TLS certificate takes a minute). */
async function waitForSite(slug, { timeoutMs = 6 * 60 * 1000 } = {}) {
  const url = siteUrl(slug);
  const started = Date.now();
  let last = {};
  while (Date.now() - started < timeoutMs) {
    last = await probeSite(url);
    if (last.up) return { url, up: true, status: last.status };
    await new Promise((res) => setTimeout(res, 15000));
  }
  return { url, up: false, status: last.status || 0, error: last.error || 'no response', router: !!last.router };
}

/** What the cluster has for a site: Ingress hosts and class, service endpoints. */
async function siteDiagnostics(slug) {
  const ing = await kubectl(['get', 'ingress', '-n', slug, '-o', 'json']);
  const items = (() => { try { return JSON.parse(ing.out).items || []; } catch { return []; } })();
  const ingText = items.length
    ? items.map((i) => `Ingress ${i.metadata.name}: class ${i.spec.ingressClassName || i.metadata.annotations?.['kubernetes.io/ingress.class'] || '(none)'}; hosts ${(i.spec.rules || []).map((r) => `${r.host} -> ${(r.http?.paths || []).map((p) => `${p.path || '/'}→${p.backend?.service?.name}:${p.backend?.service?.port?.number || p.backend?.service?.port?.name}`).join(',')}`).join('; ') || '(no rules)'}; tls ${(i.spec.tls || []).map((t) => (t.hosts || []).join('/')).join(', ') || '(none)'}`).join('\n')
    : `No Ingress in namespace ${slug} (expected one with host ${slug}.${SUFFIX}).`;
  // Traefik disables a router whose middleware is missing or broken (a
  // basicAuth middleware whose users Secret does not exist, for example) and
  // answers 404 for that host, so check every middleware the Ingresses name.
  const mw = await kubectl(['get', 'middleware.traefik.io', '-n', slug, '-o', 'json']);
  const middlewares = (() => { try { return JSON.parse(mw.out).items || []; } catch { return []; } })();
  const secrets = await kubectl(['get', 'secret', '-n', slug, '-o', 'name']);
  const secretNames = secrets.out.split('\n').map((l) => l.replace(/^secret\//, '').trim()).filter(Boolean);
  const mwLines = [];
  for (const i of items) {
    const ann = i.metadata.annotations || {};
    const eps = ann['traefik.ingress.kubernetes.io/router.entrypoints'];
    const refs = (ann['traefik.ingress.kubernetes.io/router.middlewares'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (eps || refs.length) mwLines.push(`Ingress ${i.metadata.name}: entrypoints ${eps || '(default)'}; middlewares ${refs.join(', ') || '(none)'}`);
    for (const ref of refs) {
      const name = ref.replace(/@.*$/, '').replace(new RegExp(`^${slug}-`), '');
      const m = middlewares.find((x) => x.metadata.name === name);
      if (!m) { mwLines.push(`  PROBLEM: middleware "${ref}" does not exist in namespace ${slug} (Traefik disables this router → 404)`); continue; }
      const secret = m.spec?.basicAuth?.secret || m.spec?.digestAuth?.secret;
      if (secret && !secretNames.includes(secret)) mwLines.push(`  PROBLEM: middleware "${name}" needs Secret "${secret}" which does not exist (Traefik disables this router → 404)`);
      else mwLines.push(`  middleware "${name}": ${Object.keys(m.spec || {}).join(', ') || 'empty'}${secret ? ` (secret ${secret} present)` : ''}`);
    }
  }
  const ep = await kubectl(['get', 'endpoints', '-n', slug, '--no-headers']);
  return `${ingText}\n${mwLines.join('\n')}\nEndpoints:\n${ep.out.trim() || '(none)'}`;
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

module.exports = { configured, ready, siteUrl, repoUrl, ensureGithubRepo, pushRepo, waitForImage, ciFailure, applyManifests, applyCustomDomain, probeSite, siteDiagnostics, healthy, waitForSite, resolveEnv, updateEnv, logs, setOffline, OWNER, KUBECONFIG };
