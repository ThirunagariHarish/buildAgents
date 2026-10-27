// Reminders on people's phones: subscriptions live in data/push.json, VAPID
// keys in data/push-keys.json (generated once). Works on iPhone once Jot is
// added to the home screen (iOS 16.4 and later).

const fs = require('fs');
const path = require('path');
const { generateVapidKeys, sendNotification } = require('./webpush');

const { DATA } = require('./config');
const KEYS_FILE = path.join(DATA, 'push-keys.json');
const SUBS_FILE = path.join(DATA, 'push.json');
const SUBJECT = process.env.JT_PUSH_CONTACT || 'mailto:jot@cashflowus.com';

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
  // Only the browsers' own push services: the server posts to this address, so it must not be ours to choose.
  let host = '';
  try { host = new URL(sub.endpoint).hostname.toLowerCase(); } catch {}
  if (!/(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/.test(host)) throw new Error('That is not a browser push service.');
  const list = loadSubs().filter((s) => s.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, userId: meta.userId || null, ua: String(meta.ua || '').slice(0, 200), addedAt: Date.now() });
  saveSubs(list);
  return list.filter((s) => s.userId === (meta.userId || null)).length;
}
function unsubscribe(endpoint, userId) {
  saveSubs(loadSubs().filter((s) => s.endpoint !== endpoint || (userId && s.userId !== userId)));
}
function count(userId) { return loadSubs().filter((s) => !userId || s.userId === userId).length; }
/**
 * Send to the devices of the given users (all devices when `userIds` is
 * omitted). `payload`: { title, body, tag, url, badge }. Dead subscriptions
 * are dropped. Never throws.
 */
async function broadcast(payload, userIds = null) {
  const want = userIds ? new Set(userIds) : null;
  const list = loadSubs().filter((s) => !want || want.has(s.userId));
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
  if (keep.length !== list.length) {
    const dead = new Set(list.filter((s) => !keep.includes(s)).map((s) => s.endpoint));
    saveSubs(loadSubs().filter((s) => !dead.has(s.endpoint)));
  }
  return { sent };
}

module.exports = { publicKey, subscribe, unsubscribe, count, broadcast };
