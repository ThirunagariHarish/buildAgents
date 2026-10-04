// Notifications to the owner's phone: subscriptions live in data/push.json,
// VAPID keys in data/push-keys.json (generated once). Box sends a push when
// something needs the owner or something finished; the service worker shows
// it and sets the home-screen badge to the "Needs you" count.

const fs = require('fs');
const path = require('path');
const { generateVapidKeys, sendNotification } = require('./webpush');

const DATA = path.join(__dirname, '..', 'data');
const KEYS_FILE = path.join(DATA, 'push-keys.json');
const SUBS_FILE = path.join(DATA, 'push.json');
const SUBJECT = process.env.BOX_PUSH_CONTACT || 'mailto:box@cashflowus.com';

let keys;
function vapidKeys() {
  if (keys) return keys;
  try { keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch {
    keys = generateVapidKeys();
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys), { mode: 0o600 });
  }
  return keys;
}
function publicKey() { return vapidKeys().publicKey; }

function loadSubs() {
  try { return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8')); } catch { return []; }
}
function saveSubs(list) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SUBS_FILE, JSON.stringify(list, null, 1), { mode: 0o600 });
}

function subscribe(sub, meta = {}) {
  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Not a valid push subscription.');
  if (!/^https:\/\//.test(sub.endpoint)) throw new Error('Push endpoint must be https.');
  const list = loadSubs().filter((s) => s.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, ua: String(meta.ua || '').slice(0, 200), addedAt: Date.now() });
  saveSubs(list);
  return list.length;
}
function unsubscribe(endpoint) {
  saveSubs(loadSubs().filter((s) => s.endpoint !== endpoint));
}
function count() { return loadSubs().length; }

/**
 * Send to every device. `payload`: { title, body, tag, url, badge }.
 * Dead subscriptions are dropped. Never throws.
 */
async function broadcast(payload) {
  const list = loadSubs();
  if (!list.length) return { sent: 0 };
  let sent = 0;
  const keep = [];
  for (const sub of list) {
    try {
      const r = await sendNotification(sub, payload, { keys: vapidKeys(), subject: SUBJECT });
      if (r.ok) sent += 1;
      if (!r.gone) keep.push(sub);
      if (!r.ok && !r.gone) console.error(`push: ${r.status} ${r.text.slice(0, 200)}`);
    } catch (e) {
      keep.push(sub);
      console.error(`push: ${e.message}`);
    }
  }
  if (keep.length !== list.length) saveSubs(keep);
  return { sent };
}

module.exports = { publicKey, subscribe, unsubscribe, count, broadcast };
