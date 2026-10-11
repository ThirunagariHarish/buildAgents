// A conversation with an agent: what people said to it, what it answered,
// and what arrived in its inbox. One line per entry in DATA/chat/<agent>.jsonl.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const DIR = path.join(DATA, 'chat');
fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
const file = (id) => path.join(DIR, `${id}.jsonl`);
const KEEP = 500;

function list(agentId, limit = 120) {
  let lines = [];
  try { lines = fs.readFileSync(file(agentId), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; }
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Add an entry: { role: 'you' | 'agent' | 'inbox', name, text, link?, userId? }. */
function add(agentId, entry) {
  const e = { id: crypto.randomBytes(5).toString('hex'), at: Date.now(), ...entry, text: String(entry.text || '').slice(0, 4000) };
  fs.appendFileSync(file(agentId), `${JSON.stringify(e)}\n`, { mode: 0o600 });
  const lines = fs.readFileSync(file(agentId), 'utf8').trim().split('\n');
  if (lines.length > KEEP + 100) fs.writeFileSync(file(agentId), `${lines.slice(-KEEP).join('\n')}\n`, { mode: 0o600 });
  return e;
}

function remove(agentId) { try { fs.unlinkSync(file(agentId)); } catch {} }

module.exports = { list, add, remove };
