// Due reminders go out every 30 seconds, on every channel the person has:
// a phone notification (home-screen app), Telegram, a text (if their phone is
// linked and SMS is set up) and, when none of those reached them, email.
// A reminder is marked sent before it goes out, so a restart never repeats it.

const store = require('./store');
const auth = require('./auth');
const mail = require('./mail');
const push = require('./push');
const telegram = require('./telegram');
const sms = require('./sms');
const when = require('./when');
const { BASE_URL } = require('./config');

let emit = () => {};
function setEmitter(fn) { emit = fn; }

async function deliver(uid, note) {
  const r = note.remind;
  const prefs = store.channelsOf(uid).prefs;
  const text = `Reminder: ${r.text}`;
  const via = [];
  try { const p = await push.broadcast({ title: 'Jot reminder', body: r.text, tag: `rem-${note.id}`, url: `/#/n/${note.id}` }, [uid]); if (p.sent) via.push('push'); } catch {}
  if (await telegram.sendTo(uid, text)) via.push('telegram');
  if (prefs.smsReminders !== false && await sms.sendTo(uid, text)) via.push('sms');
  if (!via.length || prefs.emailReminders) {
    const u = auth.getUser(uid);
    if (u && u.status === 'approved') {
      const d = await mail.send({ to: u.email, subject: `Reminder: ${r.text.slice(0, 80)}`, text: `${r.text}\n\nYou asked Jot to remind you ${when.describe(r.at, r.tz || 'UTC', r.at - 60000).replace(/^today /, '')}.\n\nOpen it: ${BASE_URL}/#/n/${note.id}\n` }).catch(() => ({ sent: false }));
      if (d.sent) via.push('email');
    }
  }
  return via;
}

async function tick(now = Date.now()) {
  const due = [];
  for (const { uid, notes } of store.allBooks()) for (const n of notes) if (n.remind && !n.remind.done && n.remind.at <= now && n.remind.at > now - 3 * 864e5) due.push({ uid, n });
  for (const { uid, n } of due) {
    store.updateNote(uid, n.id, { remind: { ...n.remind, done: true, sentAt: now } });
    const via = await deliver(uid, n).catch(() => []);
    store.updateNote(uid, n.id, { remind: { ...store.getNote(uid, n.id).remind, via } });
    emit({ event: 'note', uid, id: n.id });
  }
  return due.length;
}
let timer = null;
function start() { if (!timer) { timer = setInterval(() => tick().catch((e) => console.error(`reminders: ${e.message}`)), 30000); setTimeout(() => tick().catch(() => {}), 5000); } }

/** Upcoming and recent reminders of one person. */
function list(uid) {
  const all = store.notes(uid).filter((n) => n.remind);
  return {
    upcoming: all.filter((n) => !n.remind.done).sort((a, b) => a.remind.at - b.remind.at),
    done: all.filter((n) => n.remind.done).sort((a, b) => (b.remind.sentAt || b.remind.at) - (a.remind.sentAt || a.remind.at)).slice(0, 30),
  };
}

module.exports = { start, tick, list, setEmitter, deliver };
