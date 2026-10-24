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

const { DATA } = require('./config');
const USERS_FILE = path.join(DATA, 'users.json');
const SESSIONS_FILE = path.join(DATA, 'sessions.json');
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const RESET_TTL = 24 * 3600 * 1000;
const MAX_FAILS = 8;           // per account before lockout
const LOCK_MS = 15 * 60 * 1000;

const ADMIN_EMAIL = (process.env.RV_ADMIN_EMAIL || 'harishkumart1994@gmail.com').toLowerCase();
// No built-in default: without RV_ADMIN_PASSWORD the first administrator gets
// a one-time set-password link in the server log (root-only) instead.
const ADMIN_INITIAL_PASSWORD = process.env.RV_ADMIN_PASSWORD || null;

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) {
  fs.mkdirSync(DATA, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Both files may be written by another process (the deploy check creates a
// session from the shell), so reload when the file on disk changed.
function mtime(file) { try { return fs.statSync(file).mtimeMs; } catch { return 0; } }
let users = null, usersAt = 0;
function loadUsers() {
  const t = mtime(USERS_FILE);
  if (!users || t !== usersAt) { users = readJson(USERS_FILE, []); usersAt = t; }
  return users;
}
function saveUsers() { writeJson(USERS_FILE, users); usersAt = mtime(USERS_FILE); }

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
  const { salt, hash, reset, resets, fails, lockedUntil, ...rest } = u;
  return { ...rest, name: `${u.firstName} ${u.lastName}`.trim() };
}

// ---- seed the administrator -----------------------------------------------
function ensureAdmin() {
  loadUsers();
  // Accounts copied from Box have no "primary" mark: the configured
  // administrator (or else the first administrator) is the owner.
  if (users.length && !users.some((u) => u.primary)) {
    const admins = users.filter((u) => u.role === 'admin');
    const owner = admins.find((u) => u.email === ADMIN_EMAIL) || admins.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))[0];
    if (owner) { owner.primary = true; saveUsers(); console.log(`  ${owner.email} is the primary administrator.`); }
  }
  // The configured owner's account is always the owner and an administrator.
  // (Their status is left alone: an account nobody has confirmed stays locked.)
  const me = users.find((u) => u.email === ADMIN_EMAIL);
  if (me && (me.role !== 'admin' || !me.primary || users.some((u) => u.primary && u !== me))) {
    for (const u of users) if (u !== me && u.primary) delete u.primary;
    me.role = 'admin'; me.primary = true;
    saveUsers();
    console.log('  The configured owner is the primary administrator.');
  }
  if (users.some((u) => u.role === 'admin')) return;
  const u = {
    id: crypto.randomBytes(6).toString('hex'), email: ADMIN_EMAIL, firstName: 'Harish', lastName: '', phone: '',
    role: 'admin', primary: true, status: 'approved', createdAt: Date.now(), approvedAt: Date.now(),
    ...(ADMIN_INITIAL_PASSWORD ? hashPassword(ADMIN_INITIAL_PASSWORD) : {}),
  };
  users.push(u);
  saveUsers();
  console.log(`  Administrator account created for ${ADMIN_EMAIL}.`);
  if (!ADMIN_INITIAL_PASSWORD) {
    const token = issueReset(u);
    console.log(`  Set its password (one use, 24 hours): ${require('./config').BASE_URL}/#/reset/${token}`);
  }
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
let sessions = null, sessionsAt = 0;
function loadSessions() {
  const t = mtime(SESSIONS_FILE);
  if (!sessions || t !== sessionsAt) { sessions = readJson(SESSIONS_FILE, {}); sessionsAt = t; }
  return sessions;
}
function saveSessions() { writeJson(SESSIONS_FILE, sessions); sessionsAt = mtime(SESSIONS_FILE); }
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
  if (u.status === 'unverified') throw Object.assign(new Error('Open the link we emailed you to set your password first. No email? Tap "Forgot password?" to get a new one.'), { status: 403 });
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
function signup({ firstName, lastName, phone, email, ip, starter = null }) {
  if (limited(`signup:ip:${ip}`, 5, 3600 * 1000)) throw Object.assign(new Error('Too many requests from this network. Try later.'), { status: 429 });
  email = normEmail(email);
  firstName = String(firstName || '').trim().slice(0, 60);
  lastName = String(lastName || '').trim().slice(0, 60);
  phone = String(phone || '').trim().slice(0, 30);
  if (!firstName) throw Object.assign(new Error('Add your first name.'), { status: 400 });
  if (!validEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  if (phone && !/^[+\d][\d\s().-]{6,}$/.test(phone)) throw Object.assign(new Error('That phone number doesn\'t look right.'), { status: 400 });
  loadUsers();
  const existing = users.find((x) => x.email === email);
  // (kept from the shared sign-in code: a starter item waits on the account)
  if (existing) { if (starter && !existing.starter) { existing.starter = starter; saveUsers(); } return { user: existing, duplicate: true }; } // don't reveal; caller replies the same either way
  const open = require('./config').OPEN_SIGNUP;
  // Open sign-up: the account waits only for its owner to confirm the email
  // by setting a password from the link we send.
  const u = { id: crypto.randomBytes(6).toString('hex'), email, firstName, lastName, phone, role: 'user', status: open ? 'unverified' : 'pending', createdAt: Date.now(), ...(starter ? { starter } : {}) };
  users.push(u);
  saveUsers();
  return { user: u, duplicate: false, token: open ? issueReset(u) : null };
}

/** Take (and clear) the claim someone tested before signing up. */
function takeStarter(userId) {
  const u = loadUsers().find((x) => x.id === userId);
  if (!u || !u.starter) return null;
  const st = u.starter; delete u.starter; saveUsers();
  return st;
}
// The last three links sent stay valid (for 24 hours each), so asking for
// another email doesn't break the one someone opens first.
const resetsOf = (u) => (u.resets || (u.reset ? [u.reset] : [])).filter((r) => r && r.expiresAt > Date.now());
const resetMatches = (u, h) => resetsOf(u).some((r) => r.hash === h);
function issueReset(user) {
  const token = crypto.randomBytes(32).toString('base64url');
  user.resets = [...resetsOf(user).slice(-2), { hash: tokenHash(token), expiresAt: Date.now() + RESET_TTL }];
  delete user.reset;
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
/** A fresh set-password link for someone who signed up but hasn't finished; their status stays as it is. */
function relink(userId) {
  const u = loadUsers().find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such user.'), { status: 404 });
  return { user: u, token: issueReset(u) };
}
function decline(userId) {
  loadUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such request.'), { status: 404 });
  if (u.primary) throw Object.assign(new Error('The primary administrator cannot be removed.'), { status: 400 });
  users = users.filter((x) => x.id !== userId);
  saveUsers();
  destroyUserSessions(userId);
  return u;
}
function setStatus(userId, status) {
  const u = loadUsers().find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such user.'), { status: 404 });
  if (u.primary) throw Object.assign(new Error('The primary administrator cannot be changed here.'), { status: 400 });
  u.status = status;
  saveUsers();
  if (status !== 'approved') destroyUserSessions(userId);
  return u;
}
function forgot({ email, ip }) {
  if (limited(`forgot:ip:${ip}`, 5, 3600 * 1000)) throw Object.assign(new Error('Too many requests. Try later.'), { status: 429 });
  email = normEmail(email);
  const u = loadUsers().find((x) => x.email === email && (x.status === 'approved' || x.status === 'unverified'));
  if (!u) return null; // caller answers the same either way
  if (limited(`forgot:user:${u.id}`, 3, 3600 * 1000)) return null;
  return { user: u, token: issueReset(u) };
}
function resetPassword({ token, password }) {
  const h = tokenHash(token || '');
  const u = loadUsers().find((x) => resetMatches(x, h));
  if (!u) throw Object.assign(new Error('This link is no longer valid. Ask for a new one.'), { status: 400 });
  const bad = passwordProblem(password);
  if (bad) throw Object.assign(new Error(bad), { status: 400 });
  Object.assign(u, hashPassword(password));
  delete u.reset; delete u.resets;
  // Setting a password from the emailed link proves the address is theirs.
  if (u.status === 'unverified') { u.status = 'approved'; u.approvedAt = Date.now(); u.emailVerifiedAt = Date.now(); }
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
/** Only the primary administrator grants or removes the admin role. */
function setRole(userId, role) {
  if (!['admin', 'user'].includes(role)) throw Object.assign(new Error('Unknown role.'), { status: 400 });
  const u = loadUsers().find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such user.'), { status: 404 });
  if (u.primary) throw Object.assign(new Error('The primary administrator stays an administrator.'), { status: 400 });
  if (u.status !== 'approved') throw Object.assign(new Error('Approve the person first.'), { status: 400 });
  u.role = role;
  saveUsers();
  return u;
}
function tokenUser(token) {
  const h = tokenHash(token || '');
  const u = loadUsers().find((x) => resetMatches(x, h));
  return u ? publicUser(u) : null;
}

/** Set a person's plan (from Stripe, or by the administrator). */
function setPlan(userId, { plan, stripeCustomer, stripeSubscription } = {}) {
  const u = loadUsers().find((x) => x.id === userId || (stripeCustomer && x.stripeCustomer === stripeCustomer));
  if (!u) return null;
  if (plan !== undefined) u.plan = plan;
  if (stripeCustomer) u.stripeCustomer = stripeCustomer;
  if (stripeSubscription !== undefined) u.stripeSubscription = stripeSubscription;
  u.planChangedAt = Date.now();
  saveUsers();
  return u;
}
function deleteUser(userId) {
  loadUsers();
  const u = users.find((x) => x.id === userId);
  if (!u || u.primary) return false;
  users = users.filter((x) => x.id !== userId);
  saveUsers();
  destroyUserSessions(userId);
  return true;
}
/** The owner lets someone use the Claude desk (or takes it back). */
function setClaude(userId, on) {
  const u = loadUsers().find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such user.'), { status: 404 });
  u.claude = !!on;
  saveUsers();
  return u;
}
/** What someone is into, typed freely ("home espresso", "camping"). */
function setProfile(userId, { niches, firstName, lastName } = {}) {
  const u = loadUsers().find((x) => x.id === userId);
  if (!u) throw Object.assign(new Error('No such user.'), { status: 404 });
  if (Array.isArray(niches)) {
    const seen = new Set();
    u.niches = niches.map((n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter((n) => n.length >= 2 && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase())).slice(0, 12);
  }
  if (typeof firstName === 'string' && firstName.trim()) u.firstName = firstName.trim().slice(0, 60);
  if (typeof lastName === 'string') u.lastName = lastName.trim().slice(0, 60);
  saveUsers();
  return publicUser(u);
}
/** An administrator invites someone: the account waits until they set a password from the link. */
function invite({ email, firstName = '', invitedBy }) {
  email = normEmail(email);
  if (!validEmail(email)) throw Object.assign(new Error('Enter a valid email address.'), { status: 400 });
  loadUsers();
  const existing = users.find((x) => x.email === email);
  if (existing) return { user: existing, token: issueReset(existing), existing: true };
  const u = { id: crypto.randomBytes(6).toString('hex'), email, firstName: String(firstName || '').trim().slice(0, 60) || email.split('@')[0], lastName: '', phone: '', role: 'user', status: 'unverified', createdAt: Date.now(), invitedBy, invitedAt: Date.now() };
  users.push(u);
  saveUsers();
  return { user: u, token: issueReset(u), existing: false };
}
function listUsers() { return loadUsers().map(publicUser); }
function getUser(id) { return loadUsers().find((x) => x.id === id) || null; }
function admins() { return loadUsers().filter((x) => x.role === 'admin' && x.status === 'approved'); }

module.exports = {
  setProfile, invite, takeStarter, setPlan, setClaude, deleteUser, ensureAdmin, login, signup, approve, relink, decline, setStatus, setRole, forgot, resetPassword, changePassword, tokenUser,
  createSession, userForSession, destroySession, destroyUserSessions, listUsers, getUser, admins, publicUser, limited, ADMIN_EMAIL,
};
