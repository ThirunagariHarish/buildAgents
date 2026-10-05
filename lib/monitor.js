// Background care for live projects: uptime checks every five minutes, with
// a note in the thread and a push when a site goes down or comes back, plus
// a weekly digest to the phone.

const { listIdeas, saveIdea, addMessage } = require('./store');
const push = require('./push');
const { tell } = require('./notify');

const CHECK_EVERY = 5 * 60 * 1000;
const DIGEST_EVERY = 7 * 24 * 3600 * 1000;
let bus = null;

async function probe(url) {
  const started = Date.now();
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(12000) });
    // A page, a redirect or a sign-in gate is up; a 404 or an error page is not.
    return { up: (r.status >= 200 && r.status < 400) || r.status === 401 || r.status === 403, status: r.status, ms: Date.now() - started };
  } catch (e) {
    return { up: false, status: 0, ms: Date.now() - started, error: e.cause?.code || e.message };
  }
}

/** Days until the site's TLS certificate expires (null if unknown). */
function certDaysLeft(url) {
  return new Promise((resolve) => {
    let host;
    try { host = new URL(url).hostname; } catch { return resolve(null); }
    const tls = require('tls');
    const s = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = s.getPeerCertificate();
      s.end();
      if (!cert || !cert.valid_to) return resolve(null);
      resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86400000));
    });
    s.on('error', () => resolve(null));
    s.on('timeout', () => { s.destroy(); resolve(null); });
  });
}

async function checkAll() {
  for (const idea of listIdeas()) {
    const p = idea.project;
    if (!p?.url || !['review', 'maintenance', 'live'].includes(p.stage)) continue;
    const r = await probe(p.url);
    const prev = p.uptime || { up: null, checks: 0, downs: 0 };
    const changed = prev.up !== null && prev.up !== r.up;
    // Two failures in a row before calling it down, to ignore blips.
    const nowUp = r.up ? true : prev.up === false || prev.pendingDown ? false : null;
    p.uptime = {
      up: nowUp === null ? prev.up : nowUp, pendingDown: !r.up && nowUp === null,
      status: r.status, ms: r.ms, checkedAt: Date.now(), checks: prev.checks + 1,
      downs: prev.downs + (changed && !r.up && nowUp === false ? 1 : 0), since: changed && nowUp !== null ? Date.now() : (prev.since || Date.now()),
    };
    // Certificate expiry, checked once a day.
    if (!p.uptime.certCheckedAt || Date.now() - p.uptime.certCheckedAt > 86400000) {
      p.uptime.certDaysLeft = await certDaysLeft(p.url);
      p.uptime.certCheckedAt = Date.now();
      if (p.uptime.certDaysLeft !== null && p.uptime.certDaysLeft < 14 && !p.uptime.certWarnedAt) {
        p.uptime.certWarnedAt = Date.now();
        tell(idea, { title: 'Certificate expiring', body: `${idea.title}: ${p.uptime.certDaysLeft} days left on ${p.url}`, tag: `${idea.id}:cert` });
      }
    }
    saveIdea(idea);
    if (changed && nowUp !== null) {
      const msg = addMessage(idea, {
        agentId: 'system', kind: 'system', round: idea.round,
        summary: nowUp ? `${p.url.replace(/^https?:\/\//, '')} is back up` : `${p.url.replace(/^https?:\/\//, '')} is down`,
        content: nowUp ? `Answering again with HTTP ${r.status} in ${r.ms} ms.` : `No healthy response (${r.error || `HTTP ${r.status}`}). Box keeps checking every five minutes.`,
      });
      bus?.publish(idea.id, { event: 'message', message: msg });
      tell(idea, { title: nowUp ? 'Site is back up' : 'Site is down', body: `${idea.title}: ${p.url}`, tag: `${idea.id}:uptime` });
    }
    // A site that stays down gets the crew back on it: Box hands the
    // symptom and the cluster's view to the developers as a fix, which ends
    // in a redeploy that is only accepted once the page serves again. At
    // most twice a day per project, and only when the crew is idle.
    if (p.uptime.up === false && !idea.status?.match(/running/) && p.stage !== 'live') {
      const runners = require('./runners');
      const heals = (p.heals || []).filter((t) => Date.now() - t < 86400000);
      const recent = heals.length && Date.now() - heals[heals.length - 1] < 3 * 3600000;
      if (!runners.isRunning(idea.id) && heals.length < 2 && !recent) {
        p.heals = [...heals, Date.now()];
        saveIdea(idea);
        const deploy = require('./deploy');
        const diag = deploy.ready() ? await deploy.siteDiagnostics(p.slug).catch((e) => e.message) : '';
        const why = r.error || `HTTP ${r.status}`;
        const msg = addMessage(idea, {
          agentId: 'system', kind: 'system', round: idea.round,
          summary: 'Box is sending the crew to bring the site back',
          content: `${p.url} answers ${why}. The developers get the cluster's view and redeploy; the deploy only counts once the page serves again.`,
        });
        bus?.publish(idea.id, { event: 'message', message: msg });
        const feedback = `URGENT, from Box's uptime check: the live site ${p.url} is DOWN — it answers ${why}${r.status === 404 ? ' (a 404 from the cluster router means no Ingress route matches the hostname: check the Ingress objects — there must be exactly one route per host with ingressClassName traefik, path / Prefix, the app Service name and the port it listens on; two Ingresses for the same host conflict and Traefik serves 404; an app-level 404 means the front page is not served at /)' : ''}. Diagnose from the cluster state below and the manifests in deploy/k8s.yaml, fix it, and make sure the root page serves.\n\nCLUSTER STATE:\n${diag}`;
        try { require('./project').runBuild(bus, idea, { feedback }); } catch (e) { console.error(`heal ${idea.id}: ${e.message}`); }
      }
    }
  }
}

let lastDigest = 0;
async function digest() {
  const auth = require('./auth');
  const { needsYouCount } = require('./notify');
  const since = Date.now() - DIGEST_EVERY;
  for (const u of auth.listUsers().filter((x) => x.status === 'approved')) {
    const ideas = listIdeas().filter((i) => u.role === 'admin' || i.ownerId === u.id);
    const moved = ideas.filter((i) => i.messages.some((m) => m.ts > since));
    const needs = needsYouCount(u.id);
    const live = ideas.filter((i) => i.project?.url).length;
    const running = ideas.filter((i) => i.status === 'running').length;
    if (!moved.length && !needs) continue;
    await push.broadcast({
      title: 'Your week in Box',
      body: `${moved.length} ${moved.length === 1 ? 'idea moved' : 'ideas moved'}, ${needs} ${needs === 1 ? 'needs' : 'need'} you, ${live} live, ${running} running.`,
      tag: 'digest', url: '/', badge: needs, telegram: false,
    }, [u.id]).catch(() => {});
  }
}

/** Trend watch: for ideas that opted in, the Market Researcher looks for news once a week. */
async function trendWatch() {
  const { trendTurn } = require('./engine');
  for (const idea of listIdeas()) {
    if (!idea.watch || !idea.brief || idea.status === 'running') continue;
    if (idea.watchedAt && Date.now() - idea.watchedAt < DIGEST_EVERY) continue;
    try {
      await trendTurn(bus, idea);
      tell(idea, { title: 'Trend watch', body: `${idea.title}: this week's findings are in the thread.`, tag: `${idea.id}:trend` });
    } catch (e) { console.error(`trend watch: ${e.message}`); }
  }
}

function start(sseBus) {
  bus = sseBus;
  setTimeout(() => checkAll().catch(() => {}), 20000);
  setInterval(() => checkAll().catch(() => {}), CHECK_EVERY);
  setInterval(() => {
    const d = new Date();
    if (d.getDay() === 1 && d.getHours() === 8 && Date.now() - lastDigest > DIGEST_EVERY / 2) { lastDigest = Date.now(); digest().catch(() => {}); }
    if (d.getDay() === 1 && d.getHours() === 7) trendWatch().catch(() => {});
  }, 10 * 60 * 1000);
}

module.exports = { start, checkAll, probe, digest, trendWatch, certDaysLeft };
