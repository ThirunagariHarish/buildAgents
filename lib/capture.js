// One way in for every channel (the app, Telegram, SMS, a Shortcut): a jot
// becomes a note with its #tags, any reminder, link previews and pictures,
// and a short reply for chat channels ("Saved. Reminder set for 5:00 PM").
// Chat channels also understand a few words: "find <words>", "last", "undo", "help".

const store = require('./store');
const links = require('./links');
const when = require('./when');

const TAG_RE = /(^|[\s(])#([\p{L}\p{N}][\p{L}\p{N}_-]{0,31})/gu;
const tagsIn = (text) => [...new Set([...String(text || '').matchAll(TAG_RE)].map((m) => m[2].toLowerCase()))].slice(0, 12);

/** jpg / png / webp / gif / heic by their first bytes, or null. */
function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.slice(0, 6).toString() === 'GIF87a' || buf.slice(0, 6).toString() === 'GIF89a') return 'gif';
  if (buf.slice(4, 8).toString() === 'ftyp' && /hei|mif1|msf1/.test(buf.slice(8, 12).toString())) return 'heic';
  return null;
}

let hooks = { afterSave: () => {}, aiAllowed: () => false };
function setHooks(h) { hooks = { ...hooks, ...h }; }

/** Save a jot. Returns { note, reply }. */
async function jot(uid, { text = '', images = [], source = 'web', voice = false, tz = 'UTC', now = Date.now() } = {}) {
  text = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, 10000);
  const pics = [];
  for (const buf of images.slice(0, 6)) {
    const kind = imageKind(buf);
    if (kind && buf.length <= 12 * 1024 * 1024) pics.push(store.saveMedia(uid, buf, kind));
  }
  if (!text && !pics.length) return { note: null, reply: 'Nothing to save: send some words, a link or a picture.' };
  const remind = when.parseReminder(text, { now, tz });
  const found = links.findLinks(text);
  const note = store.addNote(uid, {
    text, tags: tagsIn(text), images: pics, source, ...(voice ? { voice: true } : {}),
    links: found.map((url) => ({ url, title: '', site: (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })() })),
    ...(remind ? { remind: { at: remind.at, text: remind.text.replace(TAG_RE, '$1').replace(/\s+/g, ' ').trim() || remind.text, tz, done: false } } : {}),
  });
  // Link previews fill in afterwards.
  if (found.length) enrichLinks(uid, note.id).catch(() => {});
  try { hooks.afterSave(uid, note); } catch {}
  let reply = 'Saved.';
  if (remind) reply = `Saved. I'll remind you ${when.describe(remind.at, tz, now)}: ${note.remind.text}`;
  else if (/\bremind(er)?\b/i.test(text)) reply = 'Saved. For a reminder, add a time, like "remind me to call John at 5pm" or "in 30 minutes".';
  if (note.tags.length) reply += ` #${note.tags.join(' #')}`;
  return { note, reply };
}

async function enrichLinks(uid, nid) {
  const n = store.getNote(uid, nid);
  if (!n) return;
  const out = [];
  for (const l of n.links) {
    const p = await links.preview(l.url);
    let image = null;
    if (p.imageUrl) { const buf = await links.fetchImage(p.imageUrl); const kind = imageKind(buf); if (kind) image = store.saveMedia(uid, buf, kind); }
    out.push({ url: l.url, title: p.title, site: p.site, description: p.description, image });
  }
  if (store.getNote(uid, nid)) store.updateNote(uid, nid, { links: out });
}

/** Notes matching words, #tags and dates; newest first. */
function search(uid, { q = '', tag = '', from = 0, to = 0, limit = 50, before = 0 } = {}) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const tagWords = words.filter((w) => w.startsWith('#')).map((w) => w.slice(1));
  const plain = words.filter((w) => !w.startsWith('#'));
  const tags = [...tagWords, ...(tag ? [String(tag).toLowerCase()] : [])];
  const res = [];
  for (const n of [...store.notes(uid)].sort((a, b) => b.createdAt - a.createdAt)) {
    if (before && n.createdAt >= before) continue;
    if (from && n.createdAt < from) continue;
    if (to && n.createdAt > to) continue;
    if (tags.length && !tags.every((t) => n.tags.includes(t) || (n.aiTags || []).includes(t))) continue;
    if (plain.length) {
      const hay = `${n.text} ${(n.links || []).map((l) => `${l.title} ${l.site} ${l.url}`).join(' ')} ${(n.aiTags || []).join(' ')} ${n.remind ? n.remind.text : ''}`.toLowerCase();
      if (!plain.every((w) => hay.includes(w))) continue;
    }
    res.push(n);
    if (res.length >= limit + 1) break;
  }
  return { notes: res.slice(0, limit), more: res.length > limit };
}
function tagCounts(uid) {
  const m = {};
  for (const n of store.notes(uid)) for (const t of new Set([...n.tags, ...(n.aiTags || [])])) m[t] = (m[t] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([tag, count]) => ({ tag, count }));
}

/** Chat channels: a command, or null when the message is a jot. */
function command(uid, text, tz = 'UTC') {
  const t = String(text || '').trim();
  const short = (n) => `• ${n.text.replace(/\s+/g, ' ').slice(0, 90) || (n.images.length ? '(picture)' : '')}${n.remind && !n.remind.done ? ` (reminder ${when.describe(n.remind.at, tz)})` : ''}`;
  let m;
  if (/^(help|\?|commands)$/i.test(t)) return 'Send anything and it is saved to your Jot. Add #tags to sort it. "remind me to call John at 5pm" sets a reminder. "find invoice" searches. "last" shows recent jots. "undo" deletes the last one.';
  if ((m = t.match(/^(?:find|search|\/search)\s+(.+)/i))) {
    const r = search(uid, { q: m[1], limit: 6 });
    return r.notes.length ? `Found ${r.notes.length}${r.more ? '+' : ''}:\n${r.notes.map(short).join('\n')}` : `Nothing matches "${m[1]}".`;
  }
  if (/^(last|recent|\/last)$/i.test(t)) { const ns = store.notes(uid).slice(0, 5); return ns.length ? ns.map(short).join('\n') : 'No jots yet.'; }
  if (/^(undo|\/undo)$/i.test(t)) { const n = store.notes(uid)[0]; if (!n || Date.now() - n.createdAt > 10 * 60e3) return 'Nothing recent to undo (only the last jot from the past 10 minutes).'; store.deleteNote(uid, n.id); return `Deleted: ${n.text.slice(0, 60) || 'the picture'}`; }
  return null;
}

module.exports = { jot, search, tagCounts, command, tagsIn, imageKind, enrichLinks, setHooks };
