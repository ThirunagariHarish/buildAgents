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
  const updates = require('./updates');
  const tg = require('./telegram');
  const held = holdReason(agent, channel);
  // The owner, and everyone the agent is shared with; each by their own preferences.
  const people = [agent.ownerId, ...(agent.members || []).map((m) => m.userId)];
  let pushed = 0, emailed = 0;
  for (const userId of people) {
    const person = auth.getUser(userId);
    if (!person || person.status !== 'approved') continue;
    const style = agent.notifyStyle || 'normal';
    const isOwner = userId === agent.ownerId;
    // Why nothing buzzes for this person right now, if anything holds it back.
    const why = held === 'shadow' ? 'testing' : held === 'snoozed' ? 'snoozed'
      : style === 'digest' ? 'in your daily digest'
      : prefs.pausedNow(userId) ? 'paused'
      : style !== 'urgent' && prefs.quietNow(userId) ? 'quiet hours' : null;
    // Every update is kept for the app's Updates screen, sent or not.
    const log = (via) => { for (const n of notifications) updates.add(userId, { agentId: agent.id, icon: agent.icon || null, agent: agent.title, title: n.title, body: n.body, ...(n.link ? { link: n.link } : {}), held: why, via }); };
    if (why === 'in your daily digest') { for (const n of notifications) require('./digest').add(userId, agent, n); }
    if (why) { log(null); continue; }
    // The owner's phone showed it already when the run happened there.
    const sendPush = !isOwner || viaPush;
    const via = [];
    if (!sendPush) via.push('phone');
    if (sendPush) {
      let ok = 0;
      for (const n of notifications.slice(0, 3)) {
        const r = await push.broadcast({ title: withIcon(agent.icon, n.title), body: n.body, url: `/#/a/${agent.id}`, tag: `agent:${agent.id}:${Date.now()}`, telegram: false, silent: style === 'quiet', urgent: style === 'urgent' }, [userId]).catch(() => ({ sent: 0 }));
        ok += r.sent || 0;
      }
      if (ok) via.push('push');
      pushed += ok;
      let tgOk = 0;
      for (const n of notifications.slice(0, 3)) if (await tg.sendTo(userId, { title: withIcon(agent.icon, n.title), body: n.body, url: `${BASE_URL}/#/a/${agent.id}`, silent: style === 'quiet' })) tgOk += 1;
      if (tgOk) via.push('telegram');
    }
    // Email when asked for, or when nothing else reached them.
    if (prefs.get(userId).emailAgents || (sendPush && !via.length)) {
      const r = await mail.send({
        to: person.email,
        subject: withIcon(agent.icon, notifications[0].title),
        text: `${notifications.map((n) => `${n.title}\n${n.body}${n.link ? `\n${n.link.label}: ${n.link.url}` : ''}`).join('\n\n')}\n\n— ${agent.title}${isOwner ? '' : ' (shared with you)'}, from Pocket Box\n${BASE_URL}/#/a/${agent.id}\n\nChange how agents reach you under You → Notifications.\n`,
      }).catch(() => ({ sent: false }));
      if (r.sent) { emailed += 1; via.push('email'); }
    }
    log(via.join('+') || 'app only');
  }
  return { held, pushed, emailed };
}

module.exports = { deliver, holdReason, withIcon };
