// Keys for outside services, set by the owner in Admin and kept only on the
// server (data/secrets.json, readable by the server alone). The admin page
// sees whether each is set and its last four characters, never the value.

const fs = require('fs');
const path = require('path');
const { DATA } = require('./config');

const FILE = path.join(DATA, 'secrets.json');
const NAMES = {
  telegramToken: { label: 'Telegram bot token', test: (v) => /^\d{5,}:[\w-]{30,}$/.test(v) },
  twilioSid: { label: 'Twilio account SID', test: (v) => /^AC[a-f0-9]{32}$/.test(v) },
  twilioToken: { label: 'Twilio auth token', test: (v) => /^[a-f0-9]{32}$/.test(v) },
  twilioFrom: { label: 'Twilio phone number', test: (v) => /^\+[1-9]\d{6,14}$/.test(v) },
  stripeSecret: { label: 'Stripe secret key', test: (v) => /^(sk|rk)_(live|test)_[\w]{20,}$/.test(v) },
  stripeWebhook: { label: 'Stripe webhook signing secret', test: (v) => /^whsec_[\w]{20,}$/.test(v) },
};
const all = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const get = (name) => all()[name] || process.env[`JT_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`] || '';
function set(name, value) {
  if (!NAMES[name]) throw Object.assign(new Error('Unknown setting.'), { status: 400 });
  const s = all();
  const v = String(value || '').trim();
  if (!v) delete s[name];
  else if (!NAMES[name].test(v)) throw Object.assign(new Error(`That doesn't look like a ${NAMES[name].label}.`), { status: 400 });
  else s[name] = v;
  fs.writeFileSync(FILE, JSON.stringify(s), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch {}
}
/** What the admin page may see. */
function overview() {
  return Object.fromEntries(Object.entries(NAMES).map(([k, n]) => { const v = get(k); return [k, { label: n.label, set: !!v, hint: v ? (k === 'twilioFrom' ? v : `ends in ${v.slice(-4)}`) : null }]; }));
}
module.exports = { get, set, overview, NAMES };
