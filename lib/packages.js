// Signed agent packages.
//
// The Studio holds one Ed25519 key pair (data/keys, owner-only). A release
// bundles the agent's manifest and code with its eval result and signs the
// canonical JSON. Phones pin the Studio's public key when they pair and refuse
// any package whose signature does not verify. The channel (shadow, live,
// off) is not part of the signature: going live does not need a rebuild.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const KEY_FILE = path.join(DATA, 'keys', 'signing.json');
const PKG_DIR = path.join(DATA, 'packages');
fs.mkdirSync(PKG_DIR, { recursive: true });

let keys = null;
function signingKeys() {
  if (keys) return keys;
  try { keys = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8')); } catch {}
  if (!keys) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
    keys = { publicKey: raw.toString('base64url'), privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), createdAt: Date.now() };
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY_FILE, JSON.stringify(keys), { mode: 0o600 });
  }
  return keys;
}
function publicKey() { return signingKeys().publicKey; }

/** JSON with keys sorted at every level: the bytes that get signed. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

function sign(pkg) {
  const key = crypto.createPrivateKey(signingKeys().privateKey);
  return crypto.sign(null, Buffer.from(canonical(pkg)), key).toString('base64url');
}

function verify(pkg, signature) {
  const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey(), 'base64url')]);
  const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(canonical(pkg)), key, Buffer.from(signature, 'base64url'));
}

const file = (agentId) => path.join(PKG_DIR, `${agentId}.json`);
function load(agentId) { try { return JSON.parse(fs.readFileSync(file(agentId), 'utf8')); } catch { return null; } }
function save(agentId, rec) { fs.writeFileSync(file(agentId), JSON.stringify(rec, null, 1)); }

/** Build, sign and store a release. Returns the stored record. */
function publish({ agent, manifest, code, report, commit, channel }) {
  const prev = load(agent.id);
  const pkg = {
    format: 'pocketbox.agent/1',
    agentId: agent.id, ownerId: agent.ownerId,
    manifest, code,
    evals: { passed: report.passed, total: report.scenarios.length, names: report.scenarios.map((s) => s.name) },
    commit, builtAt: new Date().toISOString(),
  };
  const rec = {
    package: pkg, signature: sign(pkg), channel: channel || prev?.channel || 'shadow', publishedAt: Date.now(),
    history: [...(prev?.history || []), { version: manifest.version, commit, at: Date.now(), evals: `${report.passed}/${report.scenarios.length}` }].slice(-30),
  };
  save(agent.id, rec);
  return rec;
}

function setChannel(agentId, channel) {
  const rec = load(agentId);
  if (!rec) throw Object.assign(new Error('This agent has not been released yet.'), { status: 409 });
  rec.channel = channel;
  rec.channelAt = Date.now();
  save(agentId, rec);
  return rec;
}

module.exports = { publicKey, canonical, sign, verify, publish, load, setChannel };
