// "Share a copy": an owner makes a link; anyone signed in who opens it can
// install their own copy of that agent's current release. The copy gets the
// agent's code, manifest and scenarios (never the owner's settings, memory or
// runs), passes the eval gate again and is signed for its new owner.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');
const store = require('./store');
const ws = require('./workspace');
const packages = require('./packages');

const FILE = path.join(DATA, 'shares.json');
const all = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const save = (v) => fs.writeFileSync(FILE, JSON.stringify(v, null, 1), { mode: 0o600 });

function create(agent, user) {
  const s = all();
  const existing = Object.entries(s).find(([, v]) => v.agentId === agent.id && !v.revoked);
  if (existing) return existing[0];
  const code = crypto.randomBytes(9).toString('base64url');
  s[code] = { agentId: agent.id, ownerId: user.id, createdAt: Date.now(), installs: 0 };
  save(s);
  return code;
}
function codeFor(agentId) { const e = Object.entries(all()).find(([, v]) => v.agentId === agentId && !v.revoked); return e ? e[0] : null; }
function revoke(agentId) { const s = all(); for (const v of Object.values(s)) if (v.agentId === agentId) v.revoked = true; save(s); }

function lookup(code) {
  const v = all()[String(code || '')];
  if (!v || v.revoked) return null;
  const a = store.loadAgent(v.agentId);
  const rec = a && packages.load(a.id);
  if (!rec) return null;
  return { v, a, rec };
}

/** What someone opening the link sees. */
function preview(code) {
  const x = lookup(code);
  if (!x) return null;
  const m = x.rec.package.manifest;
  const owner = require('./auth').getUser(x.v.ownerId);
  return {
    title: x.a.title, icon: x.a.icon || m.icon || '✳︎', description: m.description, permissions: m.permissions || [],
    triggers: m.triggers, settings: (m.settings || []).map((s) => ({ label: s.label, optional: !!s.optional })),
    http: m.http || null, evals: x.rec.package.evals, version: m.version, sharedBy: owner ? owner.firstName : 'Someone', installs: x.v.installs,
  };
}

async function install(user, code, { live = false, runsOn = 'cloud' } = {}) {
  const x = lookup(code);
  if (!x) throw Object.assign(new Error('This link no longer works.'), { status: 404 });
  const evals = ws.listFiles(x.a.id).filter((f) => /^evals\/[\w.-]+\.json$/.test(f)).map((f) => [f.slice(6), ws.readFile(x.a.id, f)]).filter(([, t]) => t !== null);
  const manifest = JSON.parse(JSON.stringify(x.rec.package.manifest));
  manifest.version = '1.0.0';
  const agent = await require('./templates').installPackage(user, {
    name: x.a.title, icon: x.a.icon, summary: manifest.description, manifest, code: x.rec.package.code, evals,
    // Someone else wrote it: it starts quietly unless the person chose otherwise.
    live: !!live, runsOn: runsOn === 'phone' ? 'phone' : 'cloud', source: { fromShare: code }, origin: `a link shared by ${(require('./auth').getUser(x.v.ownerId) || {}).firstName || 'someone'}`,
  });
  const s = all(); if (s[code]) { s[code].installs = (s[code].installs || 0) + 1; save(s); }
  return agent;
}

module.exports = { create, revoke, codeFor, preview, install };
