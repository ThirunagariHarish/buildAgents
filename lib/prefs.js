// What every agent should know about the owner: a short "about me" note and
// a set of knowledge files (text, PDF, images) attached to every debate and
// every crew turn. Stored in data/prefs.json.

const fs = require('fs');
const path = require('path');
const { resolveIds, forClaude } = require('./uploads');

const FILE = path.join(__dirname, '..', 'data', 'prefs.json');

function load() {
  try { return { about: '', knowledge: [], ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { about: '', knowledge: [] }; }
}
function save(p) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(p, null, 2));
  return p;
}
function setAbout(about) {
  const p = load();
  p.about = String(about || '').trim().slice(0, 2000);
  return save(p);
}
function addKnowledge(ids) {
  const p = load();
  const have = new Set(p.knowledge.map((k) => k.id));
  for (const a of resolveIds(ids)) if (!have.has(a.id)) p.knowledge.push(a);
  p.knowledge = p.knowledge.slice(-12);
  return save(p);
}
function removeKnowledge(id) {
  const p = load();
  p.knowledge = p.knowledge.filter((k) => k.id !== id);
  return save(p);
}

/** Text to prepend to agent prompts, and the knowledge files as attachments. */
function context() {
  const p = load();
  const lines = [];
  if (p.about) lines.push(`ABOUT THE OWNER (apply this to every judgement; they wrote it themselves):\n"""\n${p.about}\n"""`);
  if (p.knowledge.length) lines.push(`THE OWNER'S KNOWLEDGE FILES are attached to this message: ${p.knowledge.map((k) => k.name).join(', ')}. Use them when relevant.`);
  return { text: lines.join('\n\n'), attachments: p.knowledge };
}

module.exports = { load, setAbout, addKnowledge, removeKnowledge, context, forClaude };
