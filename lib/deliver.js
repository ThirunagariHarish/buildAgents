// Getting what an agent says to its owner: push to their devices, and email
// when they asked for it. Shadow-mode runs, snoozed agents and quiet hours
// deliver nothing (the run is still recorded and shown in the Studio).

const auth = require('./auth');
const push = require('./push');
const mail = require('./mail');
const prefs = require('./prefs');
const { BASE_URL } = require('./config');

/** Why nothing was delivered, or null when it may be. */
function holdReason(agent, channel) {
  if (channel !== 'live') return 'shadow';
  if (agent.snoozeUntil && agent.snoozeUntil > Date.now()) return 'snoozed';
  if (prefs.quietNow(agent.ownerId)) return 'quiet hours';
  return null;
}

/**
 * Deliver an agent's notifications. `viaPush` is false when the phone already
 * showed them itself (a run on the phone), so only the email copy goes out.
 */
async function deliver(agent, notifications, { channel, viaPush = true } = {}) {
  if (!notifications || !notifications.length) return { held: null, pushed: 0, emailed: false };
  const held = holdReason(agent, channel);
  if (held) return { held, pushed: 0, emailed: false };
  let pushed = 0;
  if (viaPush) {
    for (const n of notifications.slice(0, 3)) {
      await push.broadcast({ title: `${agent.icon || ''} ${n.title}`.trim(), body: n.body, url: `/#/a/${agent.id}`, tag: `agent:${agent.id}:${Date.now()}`, telegram: false }, [agent.ownerId]).catch(() => {});
      pushed += 1;
    }
  }
  let emailed = false;
  const owner = auth.getUser(agent.ownerId);
  // Email when they asked for it, or when they have no device that can get a push.
  if (owner && (prefs.get(owner.id).emailAgents || (viaPush && push.count(owner.id) === 0))) {
    const r = await mail.send({
      to: owner.email,
      subject: `${agent.icon || ''} ${notifications[0].title}`.trim(),
      text: `${notifications.map((n) => `${n.title}\n${n.body}`).join('\n\n')}\n\n— ${agent.title}, from Pocket Box\n${BASE_URL}/#/a/${agent.id}\n\nTurn these emails off under You → Notifications.\n`,
    }).catch(() => ({ sent: false }));
    emailed = !!r.sent;
  }
  return { held: null, pushed, emailed };
}

module.exports = { deliver, holdReason };
