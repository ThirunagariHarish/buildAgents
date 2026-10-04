// What every agent should know about an owner: a short "about me" note, a
// set of knowledge files attached to every debate and crew turn, and a few
// notification options. One file per user in data/prefs/<userId>.json.

const fs = require('fs');
const path = require('path');
const { resolveIds, forClaude } = require('./uploads');

const DIR = path.join(__dirname, '..', 'data', 'prefs');
const LEGACY = path.join(__dirname, '..', 'data', 'prefs.json');

function file(userId) { return path.join(DIR, `${String(userId || 'default').replace(/[^a-z0-9]/gi, '')}.json`); }

function load(userId) {
  try { return { about: '', knowledge: [], progressPush: true, ...JSON.parse(fs.readFileSync(file(userId), 'utf8')) }; } catch {}
  // One-time migration of the pre-accounts file to the administrator.
  try {
    const legacy = JSON.parse(fs.readFileSync(LEGACY, 'utf8'));
    if (userId && legacy) { save(userId, legacy); fs.renameSync(LEGACY, `${LEGACY}.migrated`); return { about: '', knowledge: [], progressPush: true, ...legacy }; }
  } catch {}
  return { about: '', knowledge: [], progressPush: true };
}
function save(userId, p) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file(userId), JSON.stringify(p, null, 2), { mode: 0o600 });
  return p;
}
function setAbout(userId, about) {
  const p = load(userId);
  p.about = String(about || '').trim().slice(0, 2000);
  return save(userId, p);
}
function setOption(userId, key, value) {
  if (!['progressPush'].includes(key)) throw new Error('Unknown option.');
  const p = load(userId);
  p[key] = !!value;
  return save(userId, p);
}
function addKnowledge(userId, ids) {
  const p = load(userId);
  const have = new Set(p.knowledge.map((k) => k.id));
  for (const a of resolveIds(ids)) if (!have.has(a.id)) p.knowledge.push(a);
  p.knowledge = p.knowledge.slice(-12);
  return save(userId, p);
}
function removeKnowledge(userId, id) {
  const p = load(userId);
  p.knowledge = p.knowledge.filter((k) => k.id !== id);
  return save(userId, p);
}

/** Text to prepend to agent prompts, and the knowledge files as attachments. */
function context(userId) {
  const p = load(userId);
  const lines = [];
  if (p.about) lines.push(`ABOUT THE OWNER (apply this to every judgement; they wrote it themselves):\n"""\n${p.about}\n"""`);
  if (p.knowledge.length) lines.push(`THE OWNER'S KNOWLEDGE FILES are attached to this message: ${p.knowledge.map((k) => k.name).join(', ')}. Use them when relevant.`);
  return { text: lines.join('\n\n'), attachments: p.knowledge };
}

module.exports = { load, setAbout, setOption, addKnowledge, removeKnowledge, context, forClaude };
