// Each person's preferences: time zone (for cloud schedules), whether to get
// agents' notifications by email too, and quiet hours.

const fs = require('fs');
const path = require('path');
const { DATA } = require('./config');

const FILE = path.join(DATA, 'prefs.json');
const DEFAULTS = { tz: null, emailAgents: false, quietFrom: null, quietTo: null, digestAt: '18:00', pauseUntil: null };

function all() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
function get(userId) { return { ...DEFAULTS, ...(all()[userId] || {}) }; }
function set(userId, patch) {
  const a = all();
  const cur = { ...DEFAULTS, ...(a[userId] || {}) };
  if (patch.tz !== undefined) { try { new Intl.DateTimeFormat('en', { timeZone: String(patch.tz) }); cur.tz = String(patch.tz).slice(0, 60); } catch {} }
  if (patch.emailAgents !== undefined) cur.emailAgents = !!patch.emailAgents;
  if (patch.digestAt !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch.digestAt))) cur.digestAt = String(patch.digestAt);
  for (const k of ['quietFrom', 'quietTo']) {
    if (patch[k] === null || patch[k] === '') cur[k] = null;
    else if (patch[k] !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(patch[k]))) cur[k] = String(patch[k]);
  }
  // "Pause all": nothing reaches the person until then (at most 30 days); null resumes.
  if (patch.pauseUntil === null || patch.pauseUntil === '') cur.pauseUntil = null;
  else if (patch.pauseUntil !== undefined && Number(patch.pauseUntil) > Date.now()) cur.pauseUntil = Math.min(Number(patch.pauseUntil), Date.now() + 30 * 86400000);
  a[userId] = cur;
  fs.writeFileSync(FILE, JSON.stringify(a, null, 1), { mode: 0o600 });
  return cur;
}

/** Has the person paused every agent for now? */
function pausedNow(userId) { const u = get(userId).pauseUntil; return !!u && u > Date.now(); }

/** Is it quiet hours now for this person (in their time zone)? */
function quietNow(userId, d = new Date()) {
  const p = get(userId);
  if (!p.quietFrom || !p.quietTo) return false;
  let hm;
  try { hm = new Intl.DateTimeFormat('en-GB', { timeZone: p.tz || 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch { return false; }
  return p.quietFrom <= p.quietTo ? hm >= p.quietFrom && hm < p.quietTo : hm >= p.quietFrom || hm < p.quietTo;
}

module.exports = { get, set, quietNow, pausedNow };
