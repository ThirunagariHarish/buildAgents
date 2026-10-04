// What to tell an owner's phone, and when. Every push carries that owner's
// current "Needs you" count for the home-screen badge. Notifications about
// an idea go to its owner's devices; if the idea has no owner (pre-accounts
// data) they go to the administrators.

const { listIdeas } = require('./store');
const push = require('./push');
const auth = require('./auth');

const NEEDS_YOU_STAGES = new Set(['plan_review', 'deploy_setup', 'review']);

function needsYou(i) {
  if (i.archived) return false;
  if ((i.phase || 'idea') === 'project') return NEEDS_YOU_STAGES.has(i.project?.stage) && i.status !== 'running';
  return i.status === 'done' && !!i.brief;
}
/** Ideas waiting on this user (admins see every idea), plus pending sign-ups for admins. */
function needsYouCount(userId) {
  const u = userId ? auth.getUser(userId) : null;
  const admin = u?.role === 'admin';
  const ideas = listIdeas().filter((i) => admin || !userId || i.ownerId === userId || !i.ownerId).filter(needsYou).length;
  const pending = admin ? auth.listUsers().filter((x) => x.status === 'pending').length : 0;
  return ideas + pending;
}

/** Who should hear about this idea. */
function recipients(idea) {
  const owner = idea.ownerId ? auth.getUser(idea.ownerId) : null;
  return owner ? [owner.id] : auth.admins().map((a) => a.id);
}
function sendTo(userIds, payload) {
  for (const id of userIds) push.broadcast({ ...payload, badge: needsYouCount(id) }, [id]).catch(() => {});
}

const MESSAGES = {
  brief: (i) => ({ title: 'Brief ready — review it', body: i.title }),
  plan_review: (i) => ({ title: 'Plan ready — approve it', body: `${i.title}: four documents and a prototype are waiting.` }),
  deploy_setup: (i) => ({ title: 'Built and tested', body: `${i.title} is ready to deploy once Box has its deploy credentials.` }),
  review: (i) => ({ title: 'Site ready — review it', body: `${i.title} is live at ${i.project?.url || 'its address'}.` }),
  redeployed: (i) => ({ title: 'Update is live', body: `${i.title}: the crew shipped your changes.` }),
  error: (i) => ({ title: 'The crew stopped', body: `${i.title}: ${(i.error || 'something went wrong').slice(0, 120)}` }),
  paused: (i) => ({ title: 'Paused', body: i.title }),
  needs_env: (i) => ({ title: 'The site needs a few values from you', body: `${i.title}: ${(i.project?.deploy?.missing || []).join(', ')}. Set them under Environment, then resume.` }),
};

/** Fire-and-forget. */
function notify(idea, kind) {
  const make = MESSAGES[kind];
  if (!make) return;
  sendTo(recipients(idea), { ...make(idea), tag: `${idea.id}:${kind}`, url: `/#/idea/${idea.id}` });
}

/** Lock-screen progress: one quiet notification per project, replaced in place. */
function progress(idea, body) {
  const prefs = require('./prefs');
  for (const id of recipients(idea)) {
    if (prefs.load(id).progressPush === false) continue;
    push.broadcast({ title: idea.title, body, tag: `${idea.id}:progress`, url: `/#/idea/${idea.id}`, badge: needsYouCount(id), silent: true, telegram: false }, [id]).catch(() => {});
  }
}

/** Something about an idea, to its owner (uptime, trend watch, certificates). */
function tell(idea, payload) {
  sendTo(recipients(idea), { ...payload, url: payload.url || `/#/idea/${idea.id}` });
}

/** Administrators only (sign-up requests). */
function tellAdmins(payload) {
  sendTo(auth.admins().map((a) => a.id), payload);
}

module.exports = { notify, progress, tell, tellAdmins, needsYouCount, needsYou, recipients };
