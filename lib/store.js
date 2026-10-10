// Agents, as the Studio sees them: one JSON file per agent, from the first
// idea through the room's debate, the plan, the build and every release.
//
// stage: room → brief → planning → plan_review → building → shadow → live
// status: idle | running | paused | error

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const DIR = path.join(DATA, 'agents');
fs.mkdirSync(DIR, { recursive: true });

const file = (id) => path.join(DIR, `${id}.json`);
const newId = () => crypto.randomBytes(6).toString('hex');

function saveAgent(a) {
  a.updatedAt = Date.now();
  const tmp = `${file(a.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(a, null, 1));
  fs.renameSync(tmp, file(a.id));
  return a;
}

function loadAgent(id) {
  if (!/^[a-f0-9]{12}$/.test(String(id))) return null;
  try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; }
}

function listAgents() {
  return fs.readdirSync(DIR).filter((f) => /^[a-f0-9]{12}\.json$/.test(f))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function deleteAgent(id) { try { fs.unlinkSync(file(id)); } catch {} }

function createAgent({ ownerId, idea, template, rounds }) {
  const text = String(idea || '').trim().slice(0, 4000);
  const a = {
    id: newId(), ownerId, idea: text, template: template || null,
    title: text.split(/[.!?\n]/)[0].slice(0, 60) || 'New agent',
    stage: 'room', status: 'idle', error: null,
    round: 0, maxRounds: Math.min(Math.max(Number(rounds) || 2, 1), 3),
    messages: [], brief: null, plan: null, tasks: [], cycle: 0,
    release: null, createdAt: Date.now(),
  };
  addMessage(a, { agentId: 'owner', agentName: 'You', kind: 'owner', summary: text.slice(0, 160), content: text });
  return saveAgent(a);
}

function addMessage(a, m) {
  const msg = { id: crypto.randomBytes(5).toString('hex'), ts: Date.now(), round: a.round, ...m };
  a.messages.push(msg);
  if (a.messages.length > 600) a.messages = a.messages.slice(-600);
  return msg;
}

/** What the home screen needs, without the thread. */
function summary(a) {
  return {
    id: a.id, title: a.title, icon: a.icon || null, ownerId: a.ownerId, stage: a.stage, status: a.status,
    error: a.error, updatedAt: a.updatedAt, createdAt: a.createdAt, template: a.template,
    release: a.release ? { version: a.release.version, channel: a.release.channel, publishedAt: a.release.publishedAt } : null,
    lastRun: a.lastRun || null, needsYou: needsYou(a),
  };
}

/** Why this agent is waiting on its owner, or null. */
function needsYou(a) {
  if (a.status === 'running') return null;
  if (a.status === 'error') return 'Stopped: needs a look';
  if (a.stage === 'brief') return 'Brief ready: build it or reply';
  if (a.stage === 'plan_review') return 'Plan ready: approve it';
  if (a.stage === 'shadow') return 'In shadow mode: review its runs, then go live';
  if (a.missingSettings && a.missingSettings.length) return 'Needs your settings';
  return null;
}

module.exports = { saveAgent, loadAgent, listAgents, deleteAgent, createAgent, addMessage, summary, needsYou, newId };
