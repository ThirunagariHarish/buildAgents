// Getting what an agent says to its owner: push to their devices, and email
// when they asked for it. Shadow-mode runs, snoozed agents and quiet hours
// deliver nothing (the run is still recorded and shown in the Studio).

const auth = require('./auth');
const push = require('./push');
const mail = require('./mail');
const prefs = require('./prefs');
const { BASE_URL } = require('./config');

/** The agent's icon in front of a title, once. */
const withIcon = (icon, title) => (!icon || String(title).startsWith(icon) ? String(title) : `${icon} ${title}`);

/** Why nothing was delivered, or null when it may be. */
function holdReason(agent, channel) {
  if (channel !== 'live') return 'shadow';
  if (agent.snoozeUntil && agent.snoozeUntil > Date.now()) return 'snoozed';
  return null;
}

/**
 * Deliver an agent's notifications. `viaPush` is false when the phone already
 * showed them itself (a run on the phone), so only the email copy goes out.
 */
async function deliver(agent, notifications, { channel, viaPush = true } = {}) {
  if (!notifications || !notifications.length) return { held: null, pushed: 0, emailed: 0 };
  const held = holdReason(agent, channel);
  if (held === 'shadow' || held === 'snoozed') return { held, pushed: 0, emailed: 0 };
  // The owner, and everyone the agent is shared with; each by their own preferences.
  const people = [agent.ownerId, ...(agent.members || []).map((m) => m.userId)];
  let pushed = 0, emailed = 0;
  for (const userId of people) {
    const person = auth.getUser(userId);
    if (!person || person.status !== 'approved') continue;
    const style = agent.notifyStyle || 'normal';
    // Urgent agents get through quiet hours; digest agents wait for the daily digest.
    if (style === 'digest') { for (const n of notifications) require('./digest').add(userId, agent, n); continue; }
    if (style !== 'urgent' && prefs.quietNow(userId)) continue;
    const isOwner = userId === agent.ownerId;
    // The owner's phone showed it already when the run happened there.
    const sendPush = !isOwner || viaPush;
    if (sendPush) {
      for (const n of notifications.slice(0, 3)) {
        await push.broadcast({ title: withIcon(agent.icon, n.title), body: n.body, url: `/#/a/${agent.id}`, tag: `agent:${agent.id}:${Date.now()}`, telegram: false, silent: style === 'quiet', urgent: style === 'urgent' }, [userId]).catch(() => {});
        pushed += 1;
      }
    }
    if (prefs.get(userId).emailAgents || (sendPush && push.count(userId) === 0)) {
      const r = await mail.send({
        to: person.email,
        subject: withIcon(agent.icon, notifications[0].title),
        text: `${notifications.map((n) => `${n.title}\n${n.body}`).join('\n\n')}\n\n— ${agent.title}${isOwner ? '' : ' (shared with you)'}, from Pocket Box\n${BASE_URL}/#/a/${agent.id}\n\nChange how agents reach you under You → How agents reach you.\n`,
      }).catch(() => ({ sent: false }));
      if (r.sent) emailed += 1;
    }
  }
  return { held: null, pushed, emailed };
}

module.exports = { deliver, holdReason, withIcon };
