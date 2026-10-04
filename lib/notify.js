// What to tell the owner's phone, and when. Every push carries the current
// "Needs you" count for the home-screen badge.

const { listIdeas } = require('./store');
const push = require('./push');

const NEEDS_YOU_STAGES = new Set(['plan_review', 'deploy_setup', 'review']);

function needsYou(i) {
  if ((i.phase || 'idea') === 'project') return NEEDS_YOU_STAGES.has(i.project?.stage) && i.status !== 'running';
  return i.status === 'done' && !!i.brief;
}
function needsYouCount() {
  return listIdeas().filter(needsYou).length;
}

const MESSAGES = {
  brief: (i) => ({ title: 'Brief ready — review it', body: i.title }),
  plan_review: (i) => ({ title: 'Plan ready — approve it', body: `${i.title}: four documents and a prototype are waiting.` }),
  deploy_setup: (i) => ({ title: 'Built and tested', body: `${i.title} is ready to deploy once Box has its deploy credentials.` }),
  review: (i) => ({ title: 'Site ready — review it', body: `${i.title} is live at ${i.project?.url || 'its address'}.` }),
  redeployed: (i) => ({ title: 'Update is live', body: `${i.title}: the crew shipped your changes.` }),
  error: (i) => ({ title: 'The crew stopped', body: `${i.title}: ${(i.error || 'something went wrong').slice(0, 120)}` }),
  paused: (i) => ({ title: 'Paused', body: i.title }),
};

/** Fire-and-forget. */
function notify(idea, kind) {
  const make = MESSAGES[kind];
  if (!make) return;
  const m = make(idea);
  push.broadcast({ ...m, tag: `${idea.id}:${kind}`, url: `/#/idea/${idea.id}`, badge: needsYouCount() }).catch(() => {});
}

/**
 * Lock-screen progress: one notification per project that is replaced in
 * place (same tag) as the crew moves, so the lock screen shows the latest
 * state instead of a pile of alerts. Off per owner preference.
 */
function progress(idea, body) {
  const prefs = require('./prefs').load();
  if (prefs.progressPush === false) return;
  push.broadcast({ title: idea.title, body, tag: `${idea.id}:progress`, url: `/#/idea/${idea.id}`, badge: needsYouCount(), silent: true }).catch(() => {});
}

module.exports = { notify, progress, needsYouCount };
