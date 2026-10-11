// Phones paired to an owner, what their agents did, and the two things a
// phone may ask the Studio to do for an agent: read an allowed web address,
// and hand off a hard question to Claude Code (owner-only, capped per day).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const https = require('https');
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

/** A link from an agent's run: only https, mailto, tel or sms. */
function okLink(l) {
  if (!l || typeof l !== 'object') return null;
  try { const u = new URL(String(l.url)); return ['https:', 'mailto:', 'tel:', 'sms:'].includes(u.protocol) ? { url: u.toString().slice(0, 2000), label: String(l.label || 'Open').slice(0, 40) } : null; } catch { return null; }
}

function recordRun(device, agentId, r) {
  const run = {
    id: crypto.randomBytes(5).toString('hex'), deviceId: device.id, deviceName: device.name, at: Date.now(),
    version: String(r.version || '').slice(0, 20), channel: r.channel === 'live' ? 'live' : 'shadow',
    trigger: String(r.trigger || 'manual').slice(0, 20), ok: !!r.ok, error: r.error ? String(r.error).slice(0, 500) : null,
    steps: Number(r.steps) || 0, durationMs: Number(r.durationMs) || 0,
    notifications: (Array.isArray(r.notifications) ? r.notifications : []).slice(0, 10).map((n) => ({ title: String(n.title || '').slice(0, 120), body: String(n.body || '').slice(0, 1200), ...(okLink(n.link) ? { link: okLink(n.link) } : {}) })),
    replies: (Array.isArray(r.replies) ? r.replies : []).slice(0, 5).map((x) => ({ text: String((x && x.text) || '').slice(0, 4000), ...(okLink(x && x.link) ? { link: okLink(x.link) } : {}) })),
    ...(r.input ? { input: String(r.input).slice(0, 300) } : {}),
    log: (Array.isArray(r.log) ? r.log : []).slice(-30).map((l) => String(l).slice(0, 300)),
    handoffs: Number(r.handoffs) || 0, httpReads: Number(r.httpReads) || 0,
    webhooks: (Array.isArray(r.webhooks) ? r.webhooks : []).slice(0, 10).map((w) => ({ key: String(w.key || '').slice(0, 40), sent: !!w.sent, held: !!w.held, status: Number(w.status) || 0 })),
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
function takeHandoff(ownerId, cap = HANDOFF_DAILY_CAP) {
  const u = readJson(USAGE_FILE, {});
  const d = today();
  for (const k of Object.keys(u)) if (k !== d) delete u[k];
  u[d] = u[d] || {};
  if ((u[d][ownerId] || 0) >= cap) return false;
  u[d][ownerId] = (u[d][ownerId] || 0) + 1;
  writeJson(USAGE_FILE, u);
  return true;
}

// ---- reading an allowed web address for an agent ----------------------------------
// Hosts can come from an owner's settings, so a name may point anywhere. The
// address is checked after DNS and the connection is made to that checked
// address, so a name that resolves inside our network (or flips to one) is refused.
const MAX_BODY = 500000;

function privateIp(ip) {
  ip = String(ip).toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip) || ip.startsWith('::ffff:') || ip.startsWith('64:ff9b:') || ip.startsWith('2002:');
}

function publicLookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return cb(Object.assign(new Error('That address is not on the public internet.'), { code: 'EPRIVATE' }));
    if (opts && opts.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

function getOnce(u) {
  return new Promise((resolve, reject) => {
    const req = https.get(u, {
      lookup: publicLookup, timeout: 15000,
      headers: { 'User-Agent': 'PocketBox/1 (+https://agents.cashflowus.com)', 'Accept-Encoding': 'identity' },
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { if (size < MAX_BODY) chunks.push(c); size += c.length; if (size >= MAX_BODY) res.destroy(); });
      const finish = () => resolve({ status: res.statusCode, location: res.headers.location, text: Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY) });
      res.on('end', finish);
      res.on('close', finish);
      res.on('error', finish);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('It took too long.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}

/**
 * POST JSON to a hook address the owner gave an agent. Same rules as reading:
 * https on 443, public addresses only (checked after DNS), no redirects.
 */
function httpPost(url, data) {
  let u;
  try { u = new URL(String(url || '')); } catch { return Promise.resolve({ status: 0, sent: false, text: 'That hook address is not a web address.' }); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || privateIp(u.hostname) || u.hostname === 'localhost') return Promise.resolve({ status: 0, sent: false, text: 'Hook addresses must be public https addresses.' });
  const body = Buffer.from(JSON.stringify(data === undefined ? {} : data));
  return new Promise((resolve) => {
    const req = https.request(u, {
      method: 'POST', lookup: publicLookup, timeout: 15000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'User-Agent': 'PocketBox/1 (+https://agents.cashflowus.com)' },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { if (text.length < 2000) text += c; });
      const done = () => resolve({ status: res.statusCode, sent: res.statusCode >= 200 && res.statusCode < 300, text: text.slice(0, 2000) });
      res.on('end', done); res.on('close', done);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', (e) => resolve({ status: 0, sent: false, text: e.code === 'EPRIVATE' ? 'That address is not on the public internet.' : e.code === 'ETIMEDOUT' ? 'It took too long.' : 'The hook could not be reached.' }));
    req.end(body);
  });
}

async function httpGet(manifest, url, settingValues = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return { status: 400, text: 'Not a URL.' }; }
  const allow = require('./kit/core').allowedHosts(manifest, settingValues);
  const allowed = (x) => x.protocol === 'https:' && allow.has(x.hostname.toLowerCase()) && !x.username && !x.password && (!x.port || x.port === '443') && !privateIp(x.hostname) && x.hostname !== 'localhost';
  if (!allowed(u)) return { status: 403, text: 'That address is not in the agent\'s http.allow list.' };
  try {
    let r = await getOnce(u);
    if (r.status >= 300 && r.status < 400) {
      if (!r.location) return { status: r.status, text: '' };
      const next = new URL(r.location, u);
      if (!allowed(next)) return { status: 403, text: 'Redirected to an address outside http.allow.' };
      r = await getOnce(next);
      if (r.status >= 300 && r.status < 400) return { status: r.status, text: 'Too many redirects.' };
    }
    return { status: r.status, text: r.text };
  } catch (e) {
    // Say what kind of failure it was, not what our network looks like.
    const why = e.code === 'EPRIVATE' ? 'that address is not on the public internet'
      : e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN' ? 'that name does not exist'
      : e.code === 'ETIMEDOUT' ? 'it took too long' : 'the site could not be reached';
    return { status: 0, text: `Could not read it: ${why}.` };
  }
}

module.exports = { list, pair, createCode, redeemCode, revoke, fromToken, update, recordRun, runs, handoffUsage, takeHandoff, httpGet, httpPost, privateIp, publicLookup };
