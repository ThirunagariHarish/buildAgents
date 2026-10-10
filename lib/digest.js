// The daily digest: agents set to "digest" don't buzz; what they say is
// collected per person and sent once a day, at the time each person chose.

const fs = require('fs');
const path = require('path');
const { DATA, BASE_URL } = require('./config');

const FILE = path.join(DATA, 'digest.jsonl');

function add(userId, agent, n) {
  fs.appendFileSync(FILE, `${JSON.stringify({ userId, agentId: agent.id, icon: agent.icon || '', agent: agent.title, title: n.title, body: n.body, at: Date.now() })}\n`, { mode: 0o600 });
}
function pending(userId) {
  try { return fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => !userId || x.userId === userId); } catch { return []; }
}
function take(userId) {
  const all = pending();
  const mine = all.filter((x) => x.userId === userId);
  const rest = all.filter((x) => x.userId !== userId);
  fs.writeFileSync(FILE, rest.map((x) => JSON.stringify(x)).join('\n') + (rest.length ? '\n' : ''), { mode: 0o600 });
  return mine;
}

/** Send one person's digest now, by push and (if they get agent emails, or have no push device) email. */
async function send(userId) {
  const items = take(userId);
  if (!items.length) return 0;
  const auth = require('./auth'), push = require('./push'), mail = require('./mail'), prefs = require('./prefs');
  const person = auth.getUser(userId);
  if (!person) return 0;
  const agents = [...new Set(items.map((x) => x.agent))];
  await push.broadcast({ title: `Your digest: ${items.length} update${items.length === 1 ? '' : 's'}`, body: items.slice(0, 4).map((x) => `${x.icon} ${x.title}`).join('\n'), url: '/#/', tag: 'digest', telegram: false }, [userId]).catch(() => {});
  const tg = require('./telegram');
  await tg.sendTo(userId, { title: `Your digest: ${items.length} update${items.length === 1 ? '' : 's'}`, body: items.slice(0, 10).map((x) => `${x.icon} ${x.title}`).join('\n'), url: BASE_URL });
  if (prefs.get(userId).emailAgents || (push.count(userId) === 0 && !tg.status(userId).linked)) {
    const text = agents.map((name) => {
      const mine = items.filter((x) => x.agent === name);
      return `${mine[0].icon} ${name}\n${mine.map((x) => `  • ${x.title}${x.body ? ` — ${x.body.replace(/\n/g, ' ').slice(0, 300)}` : ''}`).join('\n')}`;
    }).join('\n\n');
    await mail.send({ to: person.email, subject: `Your Pocket Box digest: ${items.length} update${items.length === 1 ? '' : 's'}`, text: `${text}\n\n${BASE_URL}\n` }).catch(() => {});
  }
  return items.length;
}

module.exports = { add, pending, send };
