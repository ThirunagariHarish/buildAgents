// Accounts and sessions.
//
// - Users live in data/users.json. Passwords are scrypt-hashed with a random
//   salt; nothing recoverable is stored.
// - Sessions are random 32-byte tokens; only their SHA-256 is stored
//   (data/sessions.json), so a leaked file cannot be replayed.
// - Sign-up is request-only: the admin approves, which sends a one-time
//   set-password link (24 h). "Forgot password" works the same way.
// - Login, sign-up and reset are rate-limited per IP and per account, with a
//   temporary lockout after repeated failures.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const RESET_TTL = 24 * 3600 * 1000;
const MAX_FAILS = 8;           // per account before lockout
const LOCK_MS = 15 * 60 * 1000;

const ADMIN_EMAIL = (process.env.BOX_ADMIN_EMAIL || 'harishkumart1994@gmail.com').toLowerCase();
const ADMIN_INITIAL_PASSWORD = process.env.BOX_ADMIN_PASSWORD || 'Harish';

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) {
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

let users = null;
function loadUsers() { if (!users) users = readJson(USERS_FILE, []); return users; }
function saveUsers() { writeJson(USERS_FILE, users); }

// ---- passwords ------------------------------------------------------------
function hashPassword(password, salt = crypto.randomBytes(16)) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return { salt: salt.toString('hex'), hash: hash.toString('hex') };
}
function verifyPassword(password, user) {
  if (!user?.salt || !user?.hash) return false;
  const h = crypto.scryptSync(String(password), Buffer.from(user.salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(h, Buffer.from(user.hash, 'hex'));
}
function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (/^(password|12345678|qwerty|letmein|iloveyou|admin123)$/i.test(pw)) return 'That password is too common.';
  return null;
}

function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120; }
function publicUser(u) {
  if (!u) return null;
  const { salt, hash, reset, fails, lockedUntil, ...rest } = u;
  return { ...rest, name: `${u.firstName} ${u.lastName}`.trim() };
}

// ---- seed the administrator -----------------------------------------------
function ensureAdmin() {
  loadUsers();
  if (users.some((u) => u.role === 'admin')) return;
  const { salt, hash } = hashPassword(ADMIN_INITIAL_PASSWORD);
  users.push({
    id: crypto.randomBytes(6).toString('hex'), email: ADMIN_EMAIL, firstName: 'Harish', lastName: '', phone: '',
    role: 'admin', status: 'approved', salt, hash, createdAt: Date.now(), approvedAt: Date.now(), weakPassword: !process.env.BOX_ADMIN_PASSWORD,
  });
  saveUsers();
  console.log(`  Administrator account created for ${ADMIN_EMAIL}.`);
}

// ---- rate limiting ---------------------------------------------------------
const buckets = new Map(); // key -> [timestamps]
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return arr.length > max;
}

// ---- sessions ---------------------------------------------------------------
let sessions = null;
function loadSessions() { if (!sessions) sessions = readJson(SESSIONS_FILE, {}); return sessions; }
function saveSessions() { writeJson(SESSIONS_FILE, sessions); }
const tokenHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

function createSession(user, ua) {
  loadSessions();
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[tokenHash(token)] = { userId: user.id, createdAt: Date.now(), seenAt: Date.now(), ua: String(ua || '').slice(0, 160) };
  // Prune expired sessions now and then.
  for (const [k, s] of Object.entries(sessions)) if (Date.now() - s.seenAt > SESSION_TTL) delete sessions[k];
  saveSessions();
  return token;
}
function userForSession(token) {
  if (!token) return null;
  loadSessions();
  const s = sessions[tokenHash(token)];
  if (!s || Date.now() - s.seenAt > SESSION_TTL) return null;
  const u = loadUsers().find((x) => x.id === s.userId);
  if (!u || u.status !== 'approved') return null;
  if (Date.now() - s.seenAt > 3600 * 1000) { s.seenAt = Date.now(); saveSessions(); }
  return u;
}
function destroySession(token) {
  if (!token) return;
  loadSessions();
  delete sessions[tokenHash(token)];
  saveSessions();
}
function destroyUserSessions(userId, { except } = {}) {
  loadSessions();
  for (const [k, s] of Object.entries(sessions)) if (s.userId === userId && k !== (except ? tokenHash(except) : null)) delete sessions[k];
  saveSessions();
}

// ---- sign in --------------------------------------------------------------
function login({ email, password, ip }) {
  email = normEmail(email);
  if (limited(`login:ip:${ip}`, 20, 10 * 60 * 1000)) throw Object.assign(new Error('Too many attempts. Try again in a few minutes.'), { status: 429 });
  const u = loadUsers().find((x) => x.email === email);
  // Same timing and message whether or not the account exists.
  if (!u) { hashPassword(password || 'x'); throw Object.assign(new Error('Email or password is not right.'), { status: 401 }); }
  if (u.lockedUntil && u.lockedUntil > Date.now()) throw Object.assign(new Error('Too many failed attempts. This account is locked for a few minutes.'), { status: 423 });
  if (u.status === 'pending') throw Object.assign(new Error('Your request is waiting for approval.'), { status: 403 });
  if (u.status === 'disabled') throw Object.assign(new Error('This account is disabled.'), { status: 403 });
  if (!u.hash || !verifyPassword(password, u)) {
    u.fails = (u.fails || 0) + 1;
    if (u.fails >= MAX_FAILS) { u.lockedUntil = Date.now() + LOCK_MS; u.fails = 0; }
    saveUsers();
    throw Object.assign(new Error('Email or password is not right.'), { status: 401 });
  }
  u.fails = 0; u.lockedUntil = 0; u.lastLoginAt = Date.now();
  saveUsers();
  return u;
}

// ---- sign up / approval / reset -------------------------------------------
function signup({ firstName, lastName, phone, email, ip }) {
  if (limited(`signup:ip:${ip}`, 5, 3600 * 1000)) throw Object.assign(new Error('Too many requests from this network. Try later.'), { status: 429 });
  email = normEmail(email);
  firstName = String(firstName || '').trim().slice(0, 60);
  lastName = String(lastName || '').trim().slice(0, 60);
  phone = String(phone || '').trim().slice(0, 30);
  if (!firstName || !lastName) throw Object.assign(new Error('First and last name are required.'), { status: 400 });
  if (!validEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  if (!/^[+\d][\d\s().-]{6,}$/.test(phone)) throw Object.assign(new Error('Enter a valid contact number.'), { status: 400 });
  loadUsers();
  const existing = users.find((x) => x.email === email);
  if (existing) return { user: existing, duplicate: true }; // don't reveal; caller replies the same either way
  const u = { id: crypto.randomBytes(6).toString('hex'), email, firstName, lastName, phone, role: 'user', status: 'pending', createdAt: Date.now() };
  users.push(u);
  saveUsers();
  return { user: u, duplicate: false };
}

function issueReset(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  user.reset = { hash: tokenHash(token), expiresAt: Date.now() + RESET_TTL };
  saveUsers();
  return token;
}
function approve(userId) {
  const u = loadUsers().find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such request.'), { status: 404 });
  u.status = 'approved';
  u.approvedAt = Date.now();
  const token = issueReset(u);
  return { user: u, token };
}
function decline(userId) {
  loadUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such request.'), { status: 404 });
  if (u.role === 'admin') throw Object.assign(new Error('The administrator cannot be removed.'), { status: 400 });
  users = users.filter((x) => x.id !== userId);
  saveUsers();
  destroyUserSessions(userId);
  return u;
}
function setStatus(userId, status) {
  const u = loadUsers().find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such user.'), { status: 404 });
  if (u.role === 'admin') throw Object.assign(new Error('The administrator cannot be changed here.'), { status: 400 });
  u.status = status;
  saveUsers();
  if (status !== 'approved') destroyUserSessions(userId);
  return u;
}
function forgot({ email, ip }) {
  if (limited(`forgot:ip:${ip}`, 5, 3600 * 1000)) throw Object.assign(new Error('Too many requests. Try later.'), { status: 429 });
  email = normEmail(email);
  const u = loadUsers().find((x) => x.email === email && x.status === 'approved');
  if (!u) return null; // caller answers the same either way
  if (limited(`forgot:user:${u.id}`, 3, 3600 * 1000)) return null;
  return { user: u, token: issueReset(u) };
}
function resetPassword({ token, password }) {
  const h = tokenHash(token || '');
  const u = loadUsers().find((x) => x.reset && x.reset.hash === h);
  if (!u || u.reset.expiresAt < Date.now()) throw Object.assign(new Error('This link is no longer valid. Ask for a new one.'), { status: 400 });
  const bad = passwordProblem(password);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  Object.assign(u, hashPassword(password));
  delete u.reset;
  u.fails = 0; u.lockedUntil = 0; u.weakPassword = false; u.passwordChangedAt = Date.now();
  saveUsers();
  destroyUserSessions(u.id);
  return u;
}
function changePassword(user, { current, next, sessionToken }) {
  if (!verifyPassword(current, user)) throw Object.assign(new Error('Your current password is not right.'), { status: 400 });
  const bad = passwordProblem(next);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  Object.assign(user, hashPassword(next));
  user.weakPassword = false; user.passwordChangedAt = Date.now();
  saveUsers();
  destroyUserSessions(user.id, { except: sessionToken });
}
function tokenUser(token) {
  const h = tokenHash(token || '');
  const u = loadUsers().find((x) => x.reset && x.reset.hash === h && x.reset.expiresAt > Date.now());
  return u ? publicUser(u) : null;
}

function listUsers() { return loadUsers().map(publicUser); }
function getUser(id) { return loadUsers().find((x) => x.id === id) || null; }
function admins() { return loadUsers().filter((x) => x.role === 'admin' && x.status === 'approved'); }

module.exports = {
  ensureAdmin, login, signup, approve, decline, setStatus, forgot, resetPassword, changePassword, tokenUser,
  createSession, userForSession, destroySession, destroyUserSessions, listUsers, getUser, admins, publicUser, limited, ADMIN_EMAIL,
};
