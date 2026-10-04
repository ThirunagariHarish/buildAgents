// Background care for live projects: uptime checks every five minutes, with
// a note in the thread and a push when a site goes down or comes back, plus
// a weekly digest to the phone.

const { listIdeas, saveIdea, addMessage } = require('./store');
const push = require('./push');
const { needsYouCount } = require('./notify');

const CHECK_EVERY = 5 * 60 * 1000;
const DIGEST_EVERY = 7 * 24 * 3600 * 1000;
let bus = null;

async function probe(url) {
  const started = Date.now();
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(12000) });
    return { up: r.status < 500, status: r.status, ms: Date.now() - started };
  } catch (e) {
    return { up: false, status: 0, ms: Date.now() - started, error: e.cause?.code || e.message };
  }
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
    saveIdea(idea);
    if (changed && nowUp !== null) {
      const msg = addMessage(idea, {
        agentId: 'system', kind: 'system', round: idea.round,
        summary: nowUp ? `${p.url.replace(/^https?:\/\//, '')} is back up` : `${p.url.replace(/^https?:\/\//, '')} is down`,
        content: nowUp ? `Answering again with HTTP ${r.status} in ${r.ms} ms.` : `No healthy response (${r.error || `HTTP ${r.status}`}). Box keeps checking every five minutes.`,
      });
      bus?.publish(idea.id, { event: 'message', message: msg });
      push.broadcast({ title: nowUp ? 'Site is back up' : 'Site is down', body: `${idea.title}: ${p.url}`, tag: `${idea.id}:uptime`, url: `/#/idea/${idea.id}`, badge: needsYouCount() }).catch(() => {});
    }
  }
}

let lastDigest = 0;
async function digest() {
  const ideas = listIdeas();
  const since = Date.now() - DIGEST_EVERY;
  const moved = ideas.filter((i) => i.messages.some((m) => m.ts > since));
  const needs = needsYouCount();
  const live = ideas.filter((i) => i.project?.url).length;
  const running = ideas.filter((i) => i.status === 'running').length;
  if (!moved.length && !needs) return;
  await push.broadcast({
    title: 'Your week in Box',
    body: `${moved.length} ${moved.length === 1 ? 'idea moved' : 'ideas moved'}, ${needs} ${needs === 1 ? 'needs' : 'need'} you, ${live} live, ${running} running.`,
    tag: 'digest', url: '/', badge: needs,
  }).catch(() => {});
}

function start(sseBus) {
  bus = sseBus;
  setTimeout(() => checkAll().catch(() => {}), 20000);
  setInterval(() => checkAll().catch(() => {}), CHECK_EVERY);
  setInterval(() => {
    const d = new Date();
    if (d.getDay() === 1 && d.getHours() === 8 && Date.now() - lastDigest > DIGEST_EVERY / 2) { lastDigest = Date.now(); digest().catch(() => {}); }
  }, 10 * 60 * 1000);
}

module.exports = { start, checkAll, probe, digest };
