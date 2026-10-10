// Phones paired to an owner, what their agents did, and the two things a
// phone may ask the Studio to do for an agent: read an allowed web address,
// and hand off a hard question to Claude Code (owner-only, capped per day).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA, HANDOFF_DAILY_CAP } = require('./config');

const DEV_FILE = path.join(DATA, 'devices.json');
const RUN_DIR = path.join(DATA, 'runs');
const USAGE_FILE = path.join(DATA, 'handoff-usage.json');
fs.mkdirSync(RUN_DIR, { recursive: true });

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function writeJson(f, v) { const t = `${f}.tmp`; fs.writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(t, f); }

function list(ownerId) {
  return readJson(DEV_FILE, []).filter((d) => !d.revoked && (!ownerId || d.ownerId === ownerId))
    .map(({ tokenHash, ...d }) => d);
}

/** Pair a phone for a signed-in owner. Returns the device token once. */
function pair(user, { name, tz, ua, platform }) {
  const devices = readJson(DEV_FILE, []);
  if (devices.filter((d) => d.ownerId === user.id && !d.revoked).length >= 10) throw Object.assign(new Error('Ten phones are paired already; remove one first.'), { status: 409 });
  const token = crypto.randomBytes(32).toString('base64url');
  const d = {
    id: crypto.randomBytes(6).toString('hex'), ownerId: user.id, name: String(name || 'Phone').slice(0, 40),
    tz: String(tz || 'UTC').slice(0, 60), ua: String(ua || '').slice(0, 160), tokenHash: sha(token),
    platform: ['web', 'android', 'ios'].includes(platform) ? platform : 'web',
    createdAt: Date.now(), lastSeenAt: Date.now(),
  };
  devices.push(d);
  writeJson(DEV_FILE, devices);
  return { device: (({ tokenHash, ...x }) => x)(d), token };
}

// ---- pairing codes (for the native apps, which have no Studio sign-in) ----------
// A signed-in owner asks for a short code; the app sends it back within ten
// minutes and gets its own device token. Codes live in memory only.
const codes = new Map(); // code -> { userId, expiresAt }
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function createCode(user) {
  for (const [c, v] of codes) if (v.expiresAt < Date.now() || v.userId === user.id) codes.delete(c);
  let code = '';
  const bytes = crypto.randomBytes(8);
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  code = `${code.slice(0, 4)}-${code.slice(4)}`;
  const expiresAt = Date.now() + 10 * 60 * 1000;
  codes.set(code, { userId: user.id, expiresAt });
  return { code, expiresAt };
}
/** Exchange a code for a device. Returns the pair() result, or null. */
function redeemCode(code, getUser, info) {
  const key = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
  const v = codes.get(key);
  if (!v || v.expiresAt < Date.now()) return null;
  codes.delete(key);
  const user = getUser(v.userId);
  if (!user || user.status !== 'approved') return null;
  return pair(user, info);
}

function revoke(ownerId, id, { admin = false } = {}) {
  const devices = readJson(DEV_FILE, []);
  const d = devices.find((x) => x.id === id && (admin || x.ownerId === ownerId));
  if (!d) return false;
  d.revoked = true;
  d.revokedAt = Date.now();
  writeJson(DEV_FILE, devices);
  return true;
}

/** The device behind a bearer token, or null. Updates last-seen (at most once a minute). */
function fromToken(token) {
  if (!token || String(token).length < 20) return null;
  const devices = readJson(DEV_FILE, []);
  const d = devices.find((x) => !x.revoked && x.tokenHash === sha(token));
  if (!d) return null;
  if (Date.now() - (d.lastSeenAt || 0) > 60000) { d.lastSeenAt = Date.now(); writeJson(DEV_FILE, devices); }
  return d;
}

function update(id, patch) {
  const devices = readJson(DEV_FILE, []);
  const d = devices.find((x) => x.id === id);
  if (!d) return;
  if (patch.tz) d.tz = String(patch.tz).slice(0, 60);
  if (patch.name) d.name = String(patch.name).slice(0, 40);
  writeJson(DEV_FILE, devices);
}

// ---- runs ------------------------------------------------------------------
const runFile = (agentId) => path.join(RUN_DIR, `${agentId}.jsonl`);

function recordRun(device, agentId, r) {
  const run = {
    id: crypto.randomBytes(5).toString('hex'), deviceId: device.id, deviceName: device.name, at: Date.now(),
    version: String(r.version || '').slice(0, 20), channel: r.channel === 'live' ? 'live' : 'shadow',
    trigger: String(r.trigger || 'manual').slice(0, 20), ok: !!r.ok, error: r.error ? String(r.error).slice(0, 500) : null,
    steps: Number(r.steps) || 0, durationMs: Number(r.durationMs) || 0,
    notifications: (Array.isArray(r.notifications) ? r.notifications : []).slice(0, 10).map((n) => ({ title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 1200) })),
    log: (Array.isArray(r.log) ? r.log : []).slice(-30).map((l) => String(l).slice(0, 300)),
    handoffs: Number(r.handoffs) || 0, httpReads: Number(r.httpReads) || 0,
  };
  fs.appendFileSync(runFile(agentId), `${JSON.stringify(run)}\n`);
  // Keep the file bounded.
  const lines = fs.readFileSync(runFile(agentId), 'utf8').trim().split('\n');
  if (lines.length > 500) fs.writeFileSync(runFile(agentId), `${lines.slice(-400).join('\n')}\n`);
  return run;
}

function runs(agentId, limit = 50) {
  try {
    return fs.readFileSync(runFile(agentId), 'utf8').trim().split('\n').filter(Boolean).slice(-limit).reverse().map((l) => JSON.parse(l));
  } catch { return []; }
}

// ---- hand-off budget -----------------------------------------------------------
function today() { return new Date().toISOString().slice(0, 10); }
function handoffUsage(ownerId) { const u = readJson(USAGE_FILE, {}); return (u[today()] || {})[ownerId] || 0; }
function takeHandoff(ownerId) {
  const u = readJson(USAGE_FILE, {});
  const d = today();
  for (const k of Object.keys(u)) if (k !== d) delete u[k];
  u[d] = u[d] || {};
  if ((u[d][ownerId] || 0) >= HANDOFF_DAILY_CAP) return false;
  u[d][ownerId] = (u[d][ownerId] || 0) + 1;
  writeJson(USAGE_FILE, u);
  return true;
}

// ---- reading an allowed web address for an agent ----------------------------------
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?|\[?f[cd])/i;

async function httpGet(manifest, url) {
  let u;
  try { u = new URL(String(url)); } catch { return { status: 400, text: 'Not a URL.' }; }
  const allow = new Set(((manifest.http && manifest.http.allow) || []).map((h) => String(h).toLowerCase()));
  if (u.protocol !== 'https:' || !allow.has(u.hostname.toLowerCase()) || PRIVATE.test(u.hostname)) return { status: 403, text: 'That address is not in the agent\'s http.allow list.' };
  try {
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'PocketBox/1 (+https://agents.cashflowus.com)' } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return { status: r.status, text: '' };
      const next = new URL(loc, u);
      if (next.protocol !== 'https:' || !allow.has(next.hostname.toLowerCase())) return { status: 403, text: 'Redirected to an address outside http.allow.' };
      const r2 = await fetch(next, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      return { status: r2.status, text: (await r2.text()).slice(0, 500000) };
    }
    return { status: r.status, text: (await r.text()).slice(0, 500000) };
  } catch (e) { return { status: 0, text: `Could not read it: ${e.cause?.code || e.message}` }; }
}

module.exports = { list, pair, createCode, redeemCode, revoke, fromToken, update, recordRun, runs, handoffUsage, takeHandoff, httpGet };
