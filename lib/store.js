// Tiny JSON-file persistence for ideas. One file per idea.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data', 'ideas');
fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = new Map();

function ideaPath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function listIdeas() {
  return fs.readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => loadIdea(f.replace(/\.json$/, '')))
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function loadIdea(id) {
  if (cache.has(id)) return cache.get(id);
  try {
    const idea = JSON.parse(fs.readFileSync(ideaPath(id), 'utf8'));
    cache.set(id, idea);
    return idea;
  } catch {
    return null;
  }
}

function saveIdea(idea) {
  cache.set(idea.id, idea);
  fs.writeFileSync(ideaPath(idea.id), JSON.stringify(idea, null, 2));
  return idea;
}

function provisionalTitle(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const t = words.slice(0, 7).join(' ');
  return words.length > 7 ? `${t}…` : t;
}

function createIdea({ title, text, attachments = [], maxRounds = 2 }) {
  const idea = {
    id: crypto.randomBytes(6).toString('hex'),
    title: (title || '').trim() || provisionalTitle(text),
    titleSource: (title || '').trim() ? 'user' : 'auto', // auto titles get replaced by a generated one
    text,
    attachments,
    createdAt: Date.now(),
    status: 'idle', // idle | running | paused | done | error
    round: 0,
    maxRounds,
    messages: [],   // { id, agentId, kind, round, summary, content, ts, model, durationMs }
    brief: null,    // final Idea Brief markdown
    error: null,
  };
  return saveIdea(idea);
}

function deleteIdea(id) {
  cache.delete(id);
  try { fs.unlinkSync(ideaPath(id)); } catch {}
}

function addMessage(idea, msg) {
  const full = {
    id: crypto.randomBytes(5).toString('hex'),
    ts: Date.now(),
    ...msg,
  };
  idea.messages.push(full);
  saveIdea(idea);
  return full;
}

function renameIdea(idea, title, source = 'user') {
  idea.title = String(title).trim().slice(0, 120);
  idea.titleSource = source;
  return saveIdea(idea);
}

module.exports = { listIdeas, loadIdea, saveIdea, createIdea, deleteIdea, addMessage, renameIdea };
