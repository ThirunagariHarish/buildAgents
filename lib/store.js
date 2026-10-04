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

function createIdea({ title, text, attachments = [], maxRounds = 2, template = null, tags = [] }) {
  const idea = {
    id: crypto.randomBytes(6).toString('hex'),
    title: (title || '').trim() || provisionalTitle(text),
    titleSource: (title || '').trim() ? 'user' : 'auto', // auto titles get replaced by a generated one
    text,
    attachments,
    template,       // idea template id (saas, marketplace, ...) or null
    tags,
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

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
}

/** Turn an idea with an approved brief into a project. */
function promoteIdea(idea) {
  const taken = new Set(listIdeas().filter((i) => i.project && i.id !== idea.id).map((i) => i.project.slug));
  const base = slugify(idea.title);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  idea.phase = 'project';
  idea.project = {
    stage: 'planning', // planning | design | building | testing | deploying | review | live | maintenance
    slug,
    promotedAt: Date.now(),
  };
  saveIdea(idea);
  return addMessage(idea, {
    agentId: 'system', kind: 'promoted', round: idea.round,
    summary: 'Promoted to project', content: `Promoted to a project. Planned address: https://${slug}.cashflowus.com`,
  });
}

/**
 * Fork an idea: a new idea with the same text and the debate up to (and
 * including) `uptoMessageId`, so a different direction can be explored.
 */
function forkIdea(idea, uptoMessageId, { title } = {}) {
  const cut = uptoMessageId ? idea.messages.findIndex((m) => m.id === uptoMessageId) : idea.messages.length - 1;
  const messages = idea.messages.slice(0, cut + 1).filter((m) => !['promoted', 'approved', 'doc', 'task', 'system', 'deployed', 'completed'].includes(m.kind));
  const lastBrief = [...messages].reverse().find((m) => m.kind === 'brief');
  const fork = {
    id: crypto.randomBytes(6).toString('hex'),
    title: (title || `${idea.title} (fork)`).slice(0, 120),
    titleSource: 'user',
    text: idea.text,
    attachments: idea.attachments || [],
    createdAt: Date.now(),
    status: lastBrief ? 'done' : 'paused',
    round: messages.reduce((m, x) => Math.max(m, x.round || 0), 0) || 1,
    maxRounds: idea.maxRounds,
    messages: messages.map((m) => ({ ...m })),
    brief: lastBrief ? lastBrief.content : null,
    error: null,
    roster: idea.roster,
    template: idea.template,
    tags: [...(idea.tags || [])],
    forkedFrom: { id: idea.id, title: idea.title, messageId: messages[messages.length - 1]?.id || null },
  };
  return saveIdea(fork);
}

module.exports = { listIdeas, loadIdea, saveIdea, createIdea, deleteIdea, addMessage, renameIdea, promoteIdea, forkIdea };
