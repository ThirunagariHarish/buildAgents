// Each agent with an inbox trigger gets a private address. Anything posted to
// it (a bank text forwarded by an iPhone Shortcut, an Apple Pay transaction,
// a forwarded email from Zapier) starts a run with that text as its input.
// The address is a secret: whoever has it can feed the agent, nothing more.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA, BASE_URL } = require('./config');

const FILE = path.join(DATA, 'inbox.json');
const all = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const save = (v) => { const t = `${FILE}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(t, FILE); };

/** The agent's address, made on first use. */
function urlFor(agentId) {
  const s = all();
  let token = Object.keys(s).find((k) => s[k] === agentId);
  if (!token) { token = crypto.randomBytes(18).toString('base64url'); s[token] = agentId; save(s); }
  return `${BASE_URL}/in/${token}`;
}
/** A new address; the old one stops working. */
function rotate(agentId) { const s = all(); for (const k of Object.keys(s)) if (s[k] === agentId) delete s[k]; save(s); return urlFor(agentId); }
function revoke(agentId) { const s = all(); for (const k of Object.keys(s)) if (s[k] === agentId) delete s[k]; save(s); }
function agentFor(token) { return /^[\w-]{20,40}$/.test(String(token || '')) ? all()[token] || null : null; }

/** Turn whatever was posted into { text, data }. */
function parse(raw, contentType = '') {
  const body = String(raw || '').slice(0, 60000);
  let data = null;
  if (/json/i.test(contentType)) { try { data = JSON.parse(body); } catch {} }
  else if (/x-www-form-urlencoded/i.test(contentType)) { try { data = Object.fromEntries(new URLSearchParams(body)); } catch {} }
  const text = data && typeof data === 'object'
    ? String(data.text || data.body || data.message || data.content || Object.entries(data).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n'))
    : body;
  const small = data && typeof data === 'object' && JSON.stringify(data).length <= 20000;
  return { text: text.slice(0, 8000), data: small ? data : null };
}

module.exports = { urlFor, rotate, revoke, agentFor, parse };
