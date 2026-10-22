// Files on disk, one JSON file per product post, plus small indexes.
//
//   data/posts/<id>.json   a product and its reinvention rounds
//   data/media/<file>      product photos and concept sketches
//   data/saves.json        { userId: [{ postId, invId, at }] }
//   data/chats/<postId>.json  { userId: [{ role, text, at }] }
//   data/settings.json     the studio's schedule and models

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA } = require('./config');

const POSTS = path.join(DATA, 'posts');
const MEDIA = path.join(DATA, 'media');
const CHATS = path.join(DATA, 'chats');
for (const d of [POSTS, MEDIA, CHATS]) fs.mkdirSync(d, { recursive: true });

const id = (n = 6) => crypto.randomBytes(n).toString('hex');
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
function writeJson(f, v) {
  const t = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(t, JSON.stringify(v));
  fs.renameSync(t, f);
}

// ---- posts -------------------------------------------------------------------------
const postFile = (pid) => path.join(POSTS, `${pid}.json`);
function createPost(fields = {}) {
  const p = { id: id(), createdAt: Date.now(), status: 'researching', product: null, image: null, rounds: [], ...fields };
  writeJson(postFile(p.id), p);
  return p;
}
function loadPost(pid) { return /^[a-f0-9]{12}$/.test(String(pid)) ? readJson(postFile(pid), null) : null; }
function savePost(p) { p.updatedAt = Date.now(); writeJson(postFile(p.id), p); return p; }
function patchPost(pid, fields) { const p = loadPost(pid); if (!p) return null; Object.assign(p, fields); return savePost(p); }
function listPosts() {
  return fs.readdirSync(POSTS).filter((f) => /^[a-f0-9]{12}\.json$/.test(f)).map((f) => readJson(path.join(POSTS, f), null)).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}
function removePost(pid) {
  const p = loadPost(pid);
  if (!p) return false;
  fs.rmSync(postFile(pid), { force: true });
  fs.rmSync(path.join(CHATS, `${pid}.json`), { force: true });
  return true;
}
/** Find a reinvention anywhere: { post, round, inv }. */
function findInvention(invId) {
  for (const p of listPosts()) for (const r of p.rounds || []) for (const inv of r.inventions || []) if (inv.id === invId) return { post: p, round: r, inv };
  return null;
}

// ---- media ---------------------------------------------------------------------------
function saveMedia(buf, ext) {
  const name = `${id(8)}.${ext}`;
  fs.writeFileSync(path.join(MEDIA, name), buf);
  return name;
}
function mediaPath(name) { return /^[a-f0-9]{16}\.(svg|jpg|png|webp)$/.test(String(name)) ? path.join(MEDIA, name) : null; }

// ---- saves ----------------------------------------------------------------------------
const SAVES = path.join(DATA, 'saves.json');
function saves(userId) { return (readJson(SAVES, {})[userId] || []); }
function setSaved(userId, postId, invId, on) {
  const all = readJson(SAVES, {});
  const list = (all[userId] || []).filter((s) => s.invId !== invId);
  if (on) list.unshift({ postId, invId, at: Date.now() });
  all[userId] = list.slice(0, 1000);
  writeJson(SAVES, all);
  return all[userId];
}

// ---- chats -----------------------------------------------------------------------------
function chat(postId, userId) { return (readJson(path.join(CHATS, `${postId}.json`), {})[userId] || []); }
function addChat(postId, userId, msg) {
  const f = path.join(CHATS, `${postId}.json`);
  const all = readJson(f, {});
  all[userId] = [...(all[userId] || []), { ...msg, at: Date.now() }].slice(-60);
  writeJson(f, all);
  return all[userId];
}

// ---- settings ---------------------------------------------------------------------------
const SETTINGS = path.join(DATA, 'settings.json');
const DEFAULTS = { intervalMin: 30, paused: false, focus: '', models: { scout: 'sonnet', inventor: 'sonnet', sourcing: 'sonnet', chat: 'sonnet' }, lastRunAt: 0, failures: 0, holdUntil: 0 };
function settings() { const s = readJson(SETTINGS, {}); return { ...DEFAULTS, ...s, models: { ...DEFAULTS.models, ...(s.models || {}) } }; }
function setSettings(patch) { const s = { ...settings(), ...patch }; writeJson(SETTINGS, s); return s; }

module.exports = { createPost, loadPost, savePost, patchPost, listPosts, removePost, findInvention, saveMedia, mediaPath, MEDIA, saves, setSaved, chat, addChat, settings, setSettings, id };
