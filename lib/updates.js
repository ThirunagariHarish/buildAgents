// Everything an agent told a person, in order: what the app's Updates screen
// shows, with how it reached them (or why it was held back). One line per
// update in DATA/updates/<userId>.jsonl.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const DIR = path.join(DATA, 'updates');
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const file = (userId) => path.join(DIR, `${String(userId).replace(/[^\w-]/g, '')}.jsonl`);
const SEEN = path.join(DIR, '_seen.json');
const KEEP = 400;

/** Add an update for one person: { agentId, icon, agent, title, body, link?, held?, via? }. */
function add(userId, u) {
  const e = { id: crypto.randomBytes(5).toString('hex'), at: Date.now(), ...u };
  fs.appendFileSync(file(userId), `${JSON.stringify(e)}\n`, { mode: 0o600 });
  const lines = fs.readFileSync(file(userId), 'utf8').trim().split('\n');
  if (lines.length > KEEP + 100) fs.writeFileSync(file(userId), `${lines.slice(-KEEP).join('\n')}\n`, { mode: 0o600 });
  require('./bus').toUser(userId, { event: 'update', update: e });
  return e;
}

/** Newest first. `agentId` narrows to one agent. */
function list(userId, { agentId, limit = 100 } = {}) {
  let lines = [];
  try { lines = fs.readFileSync(file(userId), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; }
  const all = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return (agentId ? all.filter((x) => x.agentId === agentId) : all).reverse().slice(0, limit);
}

const seenAll = () => { try { return JSON.parse(fs.readFileSync(SEEN, 'utf8')); } catch { return {}; } };
function unread(userId) { const t = seenAll()[userId] || 0; return list(userId, { limit: 100 }).filter((x) => x.at > t).length; }
function markSeen(userId) { const s = seenAll(); s[userId] = Date.now(); fs.writeFileSync(SEEN, JSON.stringify(s), { mode: 0o600 }); }
function removeAgent(agentId, userIds) {
  for (const uid of userIds) {
    try {
      const keep = fs.readFileSync(file(uid), 'utf8').trim().split('\n').filter((l) => { try { return JSON.parse(l).agentId !== agentId; } catch { return false; } });
      fs.writeFileSync(file(uid), keep.length ? `${keep.join('\n')}\n` : '', { mode: 0o600 });
    } catch {}
  }
}

module.exports = { add, list, unread, markSeen, removeAgent };
