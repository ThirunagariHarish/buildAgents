// Files on disk. Each person's notes are their own file, and their pictures
// their own folder, so nothing can mix between people.
//
//   data/notes/<userId>.json   { notes: [...] }
//   data/media/<userId>/<file> pictures (texted, uploaded, link previews)
//   data/settings.json         the owner's settings (access, price, channels)
//   data/channels.json         phone numbers, Telegram chats, capture links
//   data/push.json             web-push subscriptions
//   data/activity.json         last seen and counts, for the admin panel

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const NOTES = path.join(DATA, 'notes');
const MEDIA = path.join(DATA, 'media');
for (const d of [DATA, NOTES, MEDIA]) fs.mkdirSync(d, { recursive: true });

const id = (n = 6) => crypto.randomBytes(n).toString('hex');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
function writeJson(f, v) {
  const t = `${f}.${process.pid}.${id(3)}.tmp`;
  fs.writeFileSync(t, JSON.stringify(v), { mode: 0o600 });
  fs.renameSync(t, f);
}
const okUid = (u) => /^[a-f0-9]{12}$/.test(String(u || ''));

// ---- notes --------------------------------------------------------------------------------
const cache = new Map(); // userId -> { notes }
function book(uid) {
  if (!okUid(uid)) throw Object.assign(new Error('Bad user.'), { status: 400 });
  if (!cache.has(uid)) cache.set(uid, readJson(path.join(NOTES, `${uid}.json`), { notes: [] }));
  return cache.get(uid);
}
function saveBook(uid) { writeJson(path.join(NOTES, `${uid}.json`), book(uid)); }

/** A new note; newest first. */
function addNote(uid, fields) {
  const b = book(uid);
  const n = { id: id(), createdAt: Date.now(), updatedAt: Date.now(), text: '', tags: [], links: [], images: [], pinned: false, source: 'web', ...fields };
  b.notes.unshift(n);
  if (b.notes.length > 50000) b.notes.length = 50000;
  saveBook(uid);
  return n;
}
function getNote(uid, nid) { return book(uid).notes.find((n) => n.id === nid) || null; }
function updateNote(uid, nid, patch) {
  const n = getNote(uid, nid);
  if (!n) return null;
  Object.assign(n, patch, { updatedAt: Date.now() });
  saveBook(uid);
  return n;
}
function deleteNote(uid, nid) {
  const b = book(uid);
  const n = b.notes.find((x) => x.id === nid);
  if (!n) return false;
  b.notes = b.notes.filter((x) => x.id !== nid);
  saveBook(uid);
  // Pictures only this note used go too.
  const still = new Set(b.notes.flatMap((x) => [...(x.images || []), ...(x.links || []).map((l) => l.image).filter(Boolean)]));
  for (const f of [...(n.images || []), ...(n.links || []).map((l) => l.image).filter(Boolean)]) if (!still.has(f)) { const p = mediaPath(uid, f); if (p) fs.rmSync(p, { force: true }); }
  return true;
}
const notes = (uid) => book(uid).notes;
/** Every note of every person (for reminders and the admin totals). */
function allBooks() {
  return fs.readdirSync(NOTES).filter((f) => /^[a-f0-9]{12}\.json$/.test(f)).map((f) => ({ uid: f.slice(0, 12), notes: book(f.slice(0, 12)).notes }));
}
function removeUserData(uid) {
  if (!okUid(uid)) return;
  cache.delete(uid);
  fs.rmSync(path.join(NOTES, `${uid}.json`), { force: true });
  fs.rmSync(path.join(MEDIA, uid), { recursive: true, force: true });
}

// ---- pictures -----------------------------------------------------------------------------
function saveMedia(uid, buf, ext) {
  if (!okUid(uid)) throw new Error('Bad user.');
  const dir = path.join(MEDIA, uid);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${id(8)}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf, { mode: 0o600 });
  return name;
}
function mediaPath(uid, name) {
  if (!okUid(uid) || !/^[a-f0-9]{16}\.(jpg|png|webp|gif|heic)$/.test(String(name))) return null;
  return path.join(MEDIA, uid, name);
}

// ---- settings (the owner's) ---------------------------------------------------------------
const SETTINGS = path.join(DATA, 'settings.json');
const DEFAULTS = { access: require('./config').ACCESS, priceCents: 2900, currency: 'usd', productName: 'Jot, lifetime', models: { tag: 'haiku', ask: 'sonnet', remind: 'haiku' } };
function settings() { const s = readJson(SETTINGS, {}); return { ...DEFAULTS, ...s, models: { ...DEFAULTS.models, ...(s.models || {}) } }; }
function setSettings(patch) { const s = { ...readJson(SETTINGS, {}), ...patch }; writeJson(SETTINGS, s); return settings(); }

// ---- channels: phones, Telegram chats, capture links --------------------------------------
const CHANNELS = path.join(DATA, 'channels.json');
const chan = () => { const c = readJson(CHANNELS, {}); for (const k of ['phones', 'telegram', 'tgCodes', 'smsCodes', 'capture', 'prefs']) c[k] = c[k] || {}; return c; };
const saveChan = (c) => writeJson(CHANNELS, c);
function channelsOf(uid) {
  const c = chan();
  return {
    phone: Object.keys(c.phones).find((p) => c.phones[p] === uid) || null,
    telegram: Object.keys(c.telegram).find((k) => c.telegram[k] === uid) || null,
    capture: Object.keys(c.capture).find((k) => c.capture[k] === uid) || null,
    prefs: c.prefs[uid] || {},
  };
}
function linkPhone(phone, uid) { const c = chan(); for (const p of Object.keys(c.phones)) if (c.phones[p] === uid) delete c.phones[p]; c.phones[phone] = uid; saveChan(c); }
function unlinkPhone(uid) { const c = chan(); for (const p of Object.keys(c.phones)) if (c.phones[p] === uid) delete c.phones[p]; saveChan(c); }
const userForPhone = (phone) => chan().phones[phone] || null;
function linkTelegram(chatId, uid) { const c = chan(); for (const k of Object.keys(c.telegram)) if (c.telegram[k] === uid) delete c.telegram[k]; c.telegram[String(chatId)] = uid; saveChan(c); }
function unlinkTelegram(uid) { const c = chan(); for (const k of Object.keys(c.telegram)) if (c.telegram[k] === uid) delete c.telegram[k]; saveChan(c); }
const userForTelegram = (chatId) => chan().telegram[String(chatId)] || null;
/** One-time link codes (Telegram "/start CODE", SMS "LINK CODE"): 30 minutes. */
function issueCode(kind, uid) {
  const c = chan();
  const bag = kind === 'sms' ? c.smsCodes : c.tgCodes;
  for (const k of Object.keys(bag)) if (bag[k].uid === uid || bag[k].at < Date.now() - 30 * 60000) delete bag[k];
  const code = kind === 'sms' ? String(crypto.randomInt(100000, 999999)) : crypto.randomBytes(9).toString('base64url');
  bag[code] = { uid, at: Date.now() };
  saveChan(c);
  return code;
}
function takeCode(kind, code) {
  const c = chan();
  const bag = kind === 'sms' ? c.smsCodes : c.tgCodes;
  const v = bag[String(code)];
  if (!v) return null;
  delete bag[String(code)];
  saveChan(c);
  return v.at > Date.now() - 30 * 60000 ? v.uid : null;
}
/** The personal capture link (for iOS Shortcuts and the like); a new one replaces the old. */
function captureToken(uid, { rotate = false } = {}) {
  const c = chan();
  let t = Object.keys(c.capture).find((k) => c.capture[k] === uid);
  if (t && !rotate) return t;
  if (t) delete c.capture[t];
  t = crypto.randomBytes(18).toString('base64url');
  c.capture[t] = uid;
  saveChan(c);
  return t;
}
const userForCapture = (t) => (/^[\w-]{20,40}$/.test(String(t || '')) ? chan().capture[t] || null : null);
function setPrefs(uid, patch) { const c = chan(); c.prefs[uid] = { ...(c.prefs[uid] || {}), ...patch }; saveChan(c); return c.prefs[uid]; }
function forgetUserChannels(uid) {
  const c = chan();
  for (const bag of [c.phones, c.telegram, c.capture]) for (const k of Object.keys(bag)) if (bag[k] === uid) delete bag[k];
  delete c.prefs[uid];
  saveChan(c);
}

// ---- activity, for the admin panel ----------------------------------------------------------
const ACTIVITY = path.join(DATA, 'activity.json');
let act = null, actDirty = false;
function touch(uid, what) {
  act = act || readJson(ACTIVITY, {});
  const a = act[uid] || (act[uid] = { firstSeen: Date.now(), days: [] });
  a.lastSeen = Date.now();
  const day = new Date().toISOString().slice(0, 10);
  if (a.days[a.days.length - 1] !== day) a.days = [...a.days, day].slice(-90);
  if (what) a[what] = (a[what] || 0) + 1;
  if (!actDirty) { actDirty = true; setTimeout(() => { actDirty = false; try { writeJson(ACTIVITY, act); } catch {} }, 30000).unref(); }
}
const activity = (uid) => (act = act || readJson(ACTIVITY, {}))[uid] || null;
function flush() { if (act) writeJson(ACTIVITY, act); }

module.exports = {
  id, readJson, writeJson, DATA,
  addNote, getNote, updateNote, deleteNote, notes, allBooks, removeUserData,
  saveMedia, mediaPath,
  settings, setSettings,
  channelsOf, linkPhone, unlinkPhone, userForPhone, linkTelegram, unlinkTelegram, userForTelegram, issueCode, takeCode, captureToken, userForCapture, setPrefs, forgetUserChannels,
  touch, activity, flush,
};
