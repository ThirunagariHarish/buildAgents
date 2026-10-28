// Jot: get things out of your head and into one private, searchable feed.
// Send it anything (from the app, Telegram, a text message or an iPhone
// Shortcut): ideas, links, pictures, "remind me to call John at 5pm". It is
// tagged, searchable by words, tags and dates, and reminders come back on
// your phone. AI tagging and "ask your notes" run on the owner's Claude plan
// for the people the owner allows.
//
// Zero dependencies (Node 22).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const auth = require('./lib/auth');
const mail = require('./lib/mail');
const store = require('./lib/store');
const capture = require('./lib/capture');
const reminders = require('./lib/reminders');
const telegram = require('./lib/telegram');
const sms = require('./lib/sms');
const push = require('./lib/push');
const secrets = require('./lib/secrets');
const pay = require('./lib/pay');
const ai = require('./lib/ai');
const when = require('./lib/when');
const voice = require('./lib/voice');

const { PORT, BASE_URL } = config;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'jt_session';

// ---- helpers ----------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
const readRaw = (req, limit = 64000) => readBuf(req, limit).then((b) => b.toString('utf8'));
function readBuf(req, limit = 64000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    req.on('data', (c) => { if (done) return; size += c.length; if (size > limit) { done = true; reject(Object.assign(new Error('Too large.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
async function readBody(req, limit = 64000) {
  const raw = await readRaw(req, limit);
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Not valid JSON.'), { status: 400 }); }
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => { const i = c.indexOf('='); return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }));
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
const sessionCookie = (req, v, maxAge) => `${COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
const OUR_PROXIES = new Set(['2.25.157.104', '69.62.86.166']);
const isOurs = (ip) => { ip = String(ip || '').replace(/^::ffff:/, ''); return OUR_PROXIES.has(ip) || ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fd|fc)/i.test(ip); };
const clientIp = (req) => {
  const peer = String(req.socket.remoteAddress || '');
  if (!isOurs(peer)) return peer.replace(/^::ffff:/, '');
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!isOurs(hops[i]) || i === 0) return hops[i].replace(/^::ffff:/, '');
  return peer.replace(/^::ffff:/, '');
};
const allowed = (u) => !!u && u.status === 'approved';
const isAdmin = (u) => !!u && (u.primary || u.role === 'admin');
const currentUser = (req) => auth.userForSession(cookies(req)[COOKIE]);
const access = () => store.settings().access;

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=()');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function crossSiteWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const origin = req.headers.origin || '';
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  try { return new URL(origin).host !== host; } catch { return true; }
}

// ---- static and pictures ------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const VERSION = (() => { const h = crypto.createHash('sha256'); for (const f of fs.readdirSync(PUBLIC_DIR)) { try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch {} } return h.digest('hex').slice(0, 12); })();
function serveStatic(req, res, p) {
  const rel = p === '/' ? '/index.html' : p;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!path.extname(p)) return serveStatic(req, res, '/');
    res.writeHead(404); return res.end('not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache', ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
  if (ext === '.html') return res.end(fs.readFileSync(file, 'utf8').replace(/(src|href)="\/?([a-zA-Z-]+\.(?:js|css))"/g, `$1="/$2?v=${VERSION}"`));
  fs.createReadStream(file).pipe(res);
}
/** A person's own pictures only. */
function serveMedia(res, uid, name) {
  const f = store.mediaPath(uid, name);
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  fs.createReadStream(f).pipe(res);
}

// ---- live updates (server-sent events, each person sees only their own) ----------------------
const streams = new Map(); // res -> session token
function emit(payload) {
  for (const [res, token] of streams) {
    const u = auth.userForSession(token);
    if (!u || !allowed(u)) { streams.delete(res); try { res.end(); } catch {} continue; }
    if (payload.uid && payload.uid !== u.id) continue;
    const { uid, ...rest } = payload;
    try { res.write(`data: ${JSON.stringify(rest)}\n\n`); } catch {}
  }
}
setInterval(() => { for (const res of streams.keys()) { try { res.write(': ping\n\n'); } catch {} } }, 25000);
reminders.setEmitter(emit);

// ---- views ----------------------------------------------------------------------
const media = (f) => (f ? `/media/${f}` : null);
function noteView(n) {
  return {
    id: n.id, text: n.text, tags: n.tags, aiTags: n.aiTags || [], pinned: !!n.pinned, voice: !!n.voice, source: n.source, createdAt: n.createdAt, updatedAt: n.updatedAt,
    images: (n.images || []).map(media), links: (n.links || []).map((l) => ({ url: l.url, title: l.title || '', site: l.site || '', description: l.description || '', image: media(l.image) })),
    remind: n.remind ? { at: n.remind.at, text: n.remind.text, done: !!n.remind.done, sentAt: n.remind.sentAt || null, via: n.remind.via || [] } : null,
  };
}
const tzOf = (uid) => store.channelsOf(uid).prefs.tz || 'UTC';

// Saving a jot: AI tags for the people allowed it.
capture.setHooks({
  afterSave: (uid, note) => {
    emit({ event: 'note', uid, id: note.id });
    const u = auth.getUser(uid);
    if (ai.allowed(u) && !note.tags.length) ai.autoTag(uid, note, capture.tagCounts(uid).map((t) => t.tag));
  },
});

/** Create an account for someone (invite or purchase) and email the set-password link. */
async function grantAccount(email, name, { invitedBy = null, paid = false, by = 'Jot' } = {}) {
  const r = auth.invite({ email, firstName: name, invitedBy });
  const link = `${BASE_URL}/#/reset/${r.token}`;
  const subject = paid ? 'Your Jot is ready' : `${by} invited you to Jot`;
  const text = `Hi ${r.user.firstName},\n\n${paid ? 'Thanks for getting Jot. Your account is ready.' : `${by} invited you to Jot: one private place for every idea, link and reminder.`}\n\nChoose a password to get in (link works for 24 hours):\n\n${link}\n\nTip: on iPhone, open it in Safari, then Share, then Add to Home Screen, so Jot opens like an app and can send reminders.\n`;
  const d = await mail.send({ to: r.user.email, subject, text }).catch((e) => ({ sent: false, error: e.message }));
  return { ...r, link, sent: !!d.sent, error: d.error || null };
}

function adminView(viewer) {
  const day = 864e5, now = Date.now();
  const books = Object.fromEntries(store.allBooks().map((b) => [b.uid, b.notes]));
  const people = auth.listUsers().map((u) => {
    const a = store.activity(u.id) || {};
    const ns = books[u.id] || [];
    const ch = store.channelsOf(u.id);
    const inviter = u.invitedBy ? auth.getUser(u.invitedBy) : null;
    return {
      id: u.id, name: u.name || u.email, email: u.email, status: u.status, role: u.role, primary: !!u.primary, admin: !!u.primary || u.role === 'admin', ai: ai.allowed(u),
      joinedAt: u.createdAt || null, invitedBy: inviter ? inviter.firstName || inviter.email : null, paid: u.plan === 'lifetime',
      lastSeen: a.lastSeen || null, activeDays30: (a.days || []).filter((d) => now - Date.parse(d) < 30 * day).length,
      notes: ns.length, notes7: ns.filter((n) => now - n.createdAt < 7 * day).length, reminders: ns.filter((n) => n.remind).length,
      channels: { telegram: !!ch.telegram, sms: !!ch.phone, shortcut: (ns.some((n) => n.source === 'shortcut')), push: push.count(u.id) },
    };
  }).sort((x, y) => (y.lastSeen || 0) - (x.lastSeen || 0));
  const all = Object.values(books).flat();
  const s = store.settings();
  return {
    viewerIsOwner: !!viewer.primary,
    stats: {
      people: people.filter((x) => x.status === 'approved').length, invitedWaiting: people.filter((x) => x.status === 'unverified').length,
      activeToday: people.filter((x) => x.lastSeen && now - x.lastSeen < day).length, active7: people.filter((x) => x.lastSeen && now - x.lastSeen < 7 * day).length,
      notes: all.length, notes7: all.filter((n) => now - n.createdAt < 7 * day).length, reminders: all.filter((n) => n.remind).length,
      viaTelegram: all.filter((n) => n.source === 'telegram').length, viaSms: all.filter((n) => n.source === 'sms').length, viaShortcut: all.filter((n) => n.source === 'shortcut').length, viaVoice: all.filter((n) => n.voice).length,
      purchases: pay.purchases().length, revenue: pay.purchases().reduce((t, p) => t + (p.amount || 0), 0),
    },
    settings: { access: s.access, priceCents: s.priceCents, currency: s.currency, productName: s.productName },
    secrets: viewer.primary ? secrets.overview() : null,
    channels: { telegramBot: telegram.botName(), smsNumber: sms.number(), stripe: pay.configured(), webhookUrl: `${BASE_URL}/stripe/webhook`, smsWebhookUrl: `${BASE_URL}/sms/twilio`, mail: mail.configured(), speech: voice.available(), voiceNotes: voice.available() && !!voice.ffmpeg() },
    people,
  };
}

// ---- server ----------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  securityHeaders(req, res);
  try {
    // ---- webhooks from Stripe and Twilio (verified by signature, not by cookie) ----
    if (p === '/stripe/webhook' && req.method === 'POST') {
      const raw = await readRaw(req, 512000);
      if (!pay.verify(raw, req.headers['stripe-signature'])) return json(res, 400, { error: 'Bad signature.' });
      let event; try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'Bad body.' }); }
      const r = await pay.handleEvent(event, async (email, name) => {
        const existing = auth.listUsers().find((x) => x.email === email);
        if (existing && existing.status === 'approved') { auth.setPlan(existing.id, { plan: 'lifetime' }); await mail.send({ to: email, subject: 'Thanks for getting Jot', text: `Your Jot is yours for life. Sign in at ${BASE_URL}\n` }).catch(() => {}); return; }
        const g = await grantAccount(email, name, { paid: true });
        auth.setPlan(g.user.id, { plan: 'lifetime' });
        for (const ad of auth.admins().filter((a) => a.primary)) mail.send({ to: ad.email, subject: `New Jot purchase: ${email}`, text: `${email} bought Jot. ${g.sent ? 'They were emailed a link to set their password.' : `The email failed; send them this link: ${g.link}`}\n` }).catch(() => {});
      });
      return json(res, 200, { received: true, ...r });
    }
    if (p === '/sms/twilio' && req.method === 'POST') {
      const raw = await readRaw(req, 64000);
      const params = Object.fromEntries(new URLSearchParams(raw));
      if (!sms.validSignature(req.headers['x-twilio-signature'], params)) { res.writeHead(403); return res.end('bad signature'); }
      const xml = await sms.incoming(params);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      return res.end(xml);
    }
    // The personal capture link (iPhone Shortcuts, Android share tools, anything that can POST).
    const cm = p.match(/^\/in\/([\w-]{20,40})$/);
    if (cm && req.method === 'POST') {
      const uid = store.userForCapture(cm[1]);
      if (!uid) return json(res, 404, { error: 'Unknown link.' });
      if (auth.limited(`in:${uid}`, 120, 3600 * 1000)) return json(res, 429, { error: 'Too many in an hour.' });
      const raw = await readRaw(req, 16 * 1024 * 1024);
      const type = String(req.headers['content-type'] || '');
      let text = raw, images = [];
      if (/json/i.test(type)) { try { const j = JSON.parse(raw); text = String(j.text || j.body || j.note || ''); images = (Array.isArray(j.images) ? j.images : j.image ? [j.image] : []).slice(0, 4).map((b) => Buffer.from(String(b).replace(/^data:[^,]+,/, ''), 'base64')); } catch { return json(res, 400, { error: 'Not valid JSON.' }); } }
      else if (/x-www-form-urlencoded/i.test(type)) { const f = new URLSearchParams(raw); text = f.get('text') || f.get('body') || ''; }
      store.touch(uid, 'shortcut');
      const r = await capture.jot(uid, { text, images, source: 'shortcut', tz: tzOf(uid) });
      return json(res, r.note ? 200 : 400, { ok: !!r.note, reply: r.reply });
    }

    if (p.startsWith('/api/') && crossSiteWrite(req)) return json(res, 403, { error: 'Cross-site request refused.' });
    const ip = clientIp(req);

    // ---- public ----
    if (p === '/api/public' && req.method === 'GET') {
      const s = store.settings();
      return json(res, 200, { access: s.access, priceCents: s.priceCents, currency: s.currency, payReady: pay.configured(), telegram: !!telegram.botName(), sms: sms.configured() });
    }
    if (p === '/api/checkout' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (auth.limited(`checkout:${ip}`, 20, 3600 * 1000)) return json(res, 429, { error: 'Too many tries. Wait a bit.' });
      try { return json(res, 200, { url: await pay.checkout({ email: b.email }) }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    const ck = p.match(/^\/api\/checkout\/(cs_[\w]+)$/);
    if (ck && req.method === 'GET') { try { return json(res, 200, await pay.sessionStatus(ck[1])); } catch (e) { return json(res, 200, { paid: false, error: e.message }); } }

    // ---- accounts ----
    if (p === '/api/session' && req.method === 'GET') {
      const u = currentUser(req);
      return json(res, 200, { authed: !!u, allowed: allowed(u), admin: isAdmin(u), primary: !!(u && u.primary), ai: ai.allowed(u), speech: voice.available(), user: auth.publicUser(u), version: VERSION, access: access() });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try {
        const u = auth.login({ email: b.email, password: b.password, ip });
        res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(u, req.headers['user-agent']), 90 * 24 * 3600));
        return json(res, 200, { ok: true, allowed: allowed(u) });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Sign-in failed.' }); }
    }
    if (p === '/api/logout' && req.method === 'POST') {
      auth.destroySession(cookies(req)[COOKIE]);
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/signup' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (access() !== 'open') return json(res, 403, { error: access() === 'paid' ? 'Jot is a one-time purchase: use Get Jot to buy it, and your account is made for you.' : 'Jot is invite-only right now.' });
      try {
        const { user: nu, duplicate, token } = auth.signup({ ...b, ip });
        let delivery = { sent: true };
        if (!duplicate && token) delivery = await mail.send({ to: nu.email, subject: 'Confirm your email for Jot', text: `Hi ${nu.firstName},\n\nConfirm your email and choose a password with this link (24 hours):\n\n${BASE_URL}/#/reset/${token}\n\nIf you didn't sign up, ignore this email.\n` }).catch((e) => ({ sent: false, error: e.message }));
        else if (duplicate) { const r = auth.forgot({ email: nu.email, ip }); if (r) delivery = await mail.send({ to: nu.email, subject: 'Your Jot account', text: `Hi ${nu.firstName},\n\nYou already have an account. Sign in at ${BASE_URL}, or set a new password here (24 hours):\n\n${BASE_URL}/#/reset/${r.token}\n` }).catch((e) => ({ sent: false, error: e.message })); }
        if (!delivery.sent && mail.configured()) return json(res, 502, { error: 'Your account is saved, but the email could not be sent just now. Wait a minute, then use "Send it again".', saved: true });
        return json(res, 200, { ok: true, message: 'Check your inbox for a link to confirm your email and choose a password (24 hours; check Spam too).' });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Could not create the account.' }); }
    }
    if (p === '/api/forgot' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try {
        const r = auth.forgot({ email: b.email, ip });
        let delivery = { sent: true };
        if (r) delivery = await mail.send({ to: r.user.email, subject: r.user.status === 'unverified' ? 'Confirm your email for Jot' : 'Set your Jot password', text: `Hi ${r.user.firstName},\n\nUse this link to ${r.user.status === 'unverified' ? 'confirm your email and choose' : 'set'} your Jot password (24 hours; earlier links keep working too):\n\n${BASE_URL}/#/reset/${r.token}\n\nIf you didn't ask for this, ignore this email.\n` }).catch((e) => ({ sent: false, error: e.message }));
        if (!delivery.sent && mail.configured()) return json(res, 502, { error: 'The email could not be sent just now. Wait a minute and try again.' });
        return json(res, 200, { ok: true, message: 'If that address has an account, a link is on its way. Check Spam too.' });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (p === '/api/reset' && req.method === 'GET') { const u = auth.tokenUser(url.searchParams.get('token')); return json(res, 200, { valid: !!u, email: u?.email || null }); }
    if (p === '/api/reset' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (auth.limited(`reset:ip:${ip}`, 10, 3600 * 1000)) return json(res, 429, { error: 'Too many attempts.' });
      try { const u = auth.resetPassword({ token: b.token, password: b.password }); return json(res, 200, { ok: true, email: u.email }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }

    if (!p.startsWith('/api/') && !p.startsWith('/media/')) return serveStatic(req, res, p);

    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to continue.', login: true });
    if (!allowed(user)) return json(res, 403, { error: 'Confirm your email first: open the link we sent you.' });
    if (p.startsWith('/media/')) return serveMedia(res, user.id, p.slice(7));
    store.touch(user.id);
    const uid = user.id;

    if (p === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': hi\n\n');
      streams.set(res, cookies(req)[COOKIE]);
      req.on('close', () => streams.delete(res));
      return;
    }

    // ---- notes ----
    if (p === '/api/notes' && req.method === 'GET') {
      const r = capture.search(uid, { q: url.searchParams.get('q') || '', tag: url.searchParams.get('tag') || '', from: Number(url.searchParams.get('from')) || 0, to: Number(url.searchParams.get('to')) || 0, before: Number(url.searchParams.get('before')) || 0, limit: Math.min(100, Number(url.searchParams.get('limit')) || 40) });
      const pinned = url.searchParams.get('pinned') === '1' ? store.notes(uid).filter((n) => n.pinned).slice(0, 20).map(noteView) : undefined;
      return json(res, 200, { notes: r.notes.map(noteView), more: r.more, pinned, total: store.notes(uid).length });
    }
    if (p === '/api/notes' && req.method === 'POST') {
      if (auth.limited(`jot:${uid}`, 600, 3600 * 1000)) return json(res, 429, { error: 'That is a lot of jots this hour.' });
      const b = await readBody(req, 24 * 1024 * 1024);
      if (b.tz && when.validTz(b.tz) && b.tz !== tzOf(uid)) store.setPrefs(uid, { tz: b.tz });
      const images = (Array.isArray(b.images) ? b.images : []).slice(0, 6).map((x) => Buffer.from(String(x).replace(/^data:[^,]+,/, ''), 'base64'));
      const r = await capture.jot(uid, { text: b.text, images, source: 'web', voice: b.voice === true, tz: tzOf(uid) });
      if (!r.note) return json(res, 400, { error: r.reply });
      return json(res, 200, { note: noteView(r.note), reply: r.reply });
    }
    const nm = p.match(/^\/api\/notes\/([a-f0-9]{12})(\/remind)?$/);
    if (nm) {
      const n = store.getNote(uid, nm[1]);
      if (!n) return json(res, 404, { error: 'No such note.' });
      if (!nm[2] && req.method === 'GET') return json(res, 200, { note: noteView(n) });
      if (!nm[2] && req.method === 'PATCH') {
        const b = await readBody(req);
        const patch = {};
        if (typeof b.pinned === 'boolean') patch.pinned = b.pinned;
        if (typeof b.text === 'string' && b.text.trim() && b.text !== n.text) {
          const text = b.text.trim().slice(0, 10000);
          patch.text = text; patch.tags = capture.tagsIn(text);
          if (!n.remind || !n.remind.done) { const r = when.parseReminder(text, { tz: tzOf(uid) }); patch.remind = r ? { at: r.at, text: r.text, tz: tzOf(uid), done: false } : n.remind && !/\bremind/i.test(text) ? null : n.remind; }
        }
        if (Array.isArray(b.removeAiTags)) patch.aiTags = (n.aiTags || []).filter((t) => !b.removeAiTags.includes(t));
        const out = store.updateNote(uid, n.id, patch);
        if (patch.text) capture.enrichLinks(uid, n.id).catch(() => {});
        emit({ event: 'note', uid, id: n.id });
        return json(res, 200, { note: noteView(out) });
      }
      if (!nm[2] && req.method === 'DELETE') { store.deleteNote(uid, n.id); emit({ event: 'note', uid, id: n.id, removed: true }); return json(res, 200, { ok: true }); }
      if (nm[2] && req.method === 'POST') {
        const b = await readBody(req);
        let remind = null;
        if (b.off) remind = null;
        else if (Number(b.snoozeMin) > 0) remind = { at: Date.now() + Math.min(Number(b.snoozeMin), 7 * 1440) * 60e3, text: (n.remind && n.remind.text) || n.text.slice(0, 120) || 'Reminder', tz: tzOf(uid), done: false };
        else if (Number(b.at) > Date.now()) remind = { at: Number(b.at), text: String(b.text || (n.remind && n.remind.text) || n.text.slice(0, 120) || 'Reminder').slice(0, 300), tz: tzOf(uid), done: false };
        else return json(res, 400, { error: 'Pick a time in the future.' });
        const out = store.updateNote(uid, n.id, { remind });
        emit({ event: 'note', uid, id: n.id });
        return json(res, 200, { note: noteView(out), when: remind ? when.describe(remind.at, tzOf(uid)) : null });
      }
      return json(res, 404, { error: 'Not found.' });
    }
    if (p === '/api/tags' && req.method === 'GET') return json(res, 200, { tags: capture.tagCounts(uid) });
    if (p === '/api/reminders' && req.method === 'GET') { const r = reminders.list(uid); return json(res, 200, { upcoming: r.upcoming.map(noteView), done: r.done.map(noteView) }); }
    if (p === '/api/export' && req.method === 'GET') {
      const ns = store.notes(uid);
      if (url.searchParams.get('format') === 'md') {
        const md = ns.map((n) => `## ${new Date(n.createdAt).toISOString().replace('T', ' ').slice(0, 16)}${n.tags.length ? `  #${n.tags.join(' #')}` : ''}\n\n${n.text}${(n.links || []).length ? `\n\n${n.links.map((l) => `- [${l.title || l.url}](${l.url})`).join('\n')}` : ''}${n.remind ? `\n\nReminder: ${n.remind.text} (${new Date(n.remind.at).toISOString()})` : ''}\n`).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="jot-export.md"' });
        return res.end(md);
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="jot-export.json"' });
      return res.end(JSON.stringify({ exportedAt: new Date().toISOString(), notes: ns.map(({ images, ...n }) => n) }, null, 1));
    }

    // ---- speaking instead of typing (the browser sends 16 kHz mono PCM) ----
    if (p === '/api/transcribe' && req.method === 'POST') {
      if (auth.limited(`voice:${uid}`, 120, 3600 * 1000)) return json(res, 429, { error: 'That is a lot of recordings this hour.' });
      const pcm = await readBuf(req, 2400000);
      if (pcm.length < 3200) return json(res, 400, { error: "Didn't catch that. Hold the mic a little longer." });
      try { return json(res, 200, { text: await voice.transcribe(pcm) }); }
      catch (e) { console.error(`voice: ${e.message}`); return json(res, e.status || 502, { error: e.status ? e.message : 'Could not turn that into text just now. Try again.' }); }
    }

    // ---- AI (the owner's Claude plan; owner, admins and people granted it) ----
    if (p === '/api/ask' && req.method === 'POST') {
      if (!ai.allowed(user)) return json(res, 403, { error: 'Ask is not turned on for your account.' });
      if (auth.limited(`ask:${uid}`, 40, 24 * 3600 * 1000)) return json(res, 429, { error: 'That is a lot of questions today. Try again tomorrow.' });
      const b = await readBody(req);
      if (!String(b.question || '').trim()) return json(res, 400, { error: 'Ask a question first.' });
      try { const r = await ai.ask(uid, b.question); return json(res, 200, { answer: r.answer, cited: r.cited.map((c) => ({ k: c.k, n: store.getNote(uid, c.id) })).filter((c) => c.n).map((c) => ({ k: c.k, note: noteView(c.n) })) }); }
      catch (e) { return json(res, 502, { error: /usage limit|rate limit/i.test(e.message) ? 'The AI is resting after hitting its usage limit. Try again later.' : 'The AI could not answer just now. Try again in a minute.' }); }
    }

    // ---- settings and channels ----
    if (p === '/api/settings' && req.method === 'GET') {
      const ch = store.channelsOf(uid);
      return json(res, 200, {
        user: auth.publicUser(auth.getUser(uid)), prefs: { tz: tzOf(uid), smsReminders: ch.prefs.smsReminders !== false, emailReminders: !!ch.prefs.emailReminders },
        telegram: { ready: !!secrets.get('telegramToken'), linked: !!ch.telegram, bot: telegram.botName() },
        sms: { ready: sms.configured(), number: sms.number(), phone: ch.phone ? ch.phone.replace(/^(\+\d{1,3})\d*(\d{2})$/, '$1 ••• $2') : null },
        capture: `${BASE_URL}/in/${store.captureToken(uid)}`, push: { key: push.publicKey(), devices: push.count(uid) }, ai: ai.allowed(user), notes: store.notes(uid).length,
      });
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const b = await readBody(req);
      const patch = {};
      if (b.tz && when.validTz(b.tz)) patch.tz = b.tz;
      if (typeof b.smsReminders === 'boolean') patch.smsReminders = b.smsReminders;
      if (typeof b.emailReminders === 'boolean') patch.emailReminders = b.emailReminders;
      store.setPrefs(uid, patch);
      if (typeof b.firstName === 'string' || typeof b.lastName === 'string') auth.setProfile(uid, { firstName: b.firstName, lastName: b.lastName });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/channels/telegram' && req.method === 'POST') { const link = await telegram.connectLink(uid); return link ? json(res, 200, { url: link }) : json(res, 503, { error: 'Telegram is not set up yet. Ask the owner to add a bot in Admin.' }); }
    if (p === '/api/channels/telegram' && req.method === 'DELETE') { store.unlinkTelegram(uid); return json(res, 200, { ok: true }); }
    if (p === '/api/channels/sms' && req.method === 'POST') { if (!sms.configured()) return json(res, 503, { error: 'Texting is not set up yet.' }); return json(res, 200, { code: store.issueCode('sms', uid), number: sms.number() }); }
    if (p === '/api/channels/sms' && req.method === 'DELETE') { store.unlinkPhone(uid); return json(res, 200, { ok: true }); }
    if (p === '/api/channels/capture' && req.method === 'POST') return json(res, 200, { url: `${BASE_URL}/in/${store.captureToken(uid, { rotate: true })}` });
    if (p === '/api/push/subscribe' && req.method === 'POST') { const b = await readBody(req); try { return json(res, 200, { devices: push.subscribe(b.subscription, { userId: uid, ua: req.headers['user-agent'] }) }); } catch (e) { return json(res, 400, { error: e.message }); } }
    if (p === '/api/push/test' && req.method === 'POST') { const r = await push.broadcast({ title: 'Jot', body: 'Reminders will look like this.', tag: 'test', url: '/#/' }, [uid]); return json(res, 200, r); }
    if (p === '/api/account' && req.method === 'DELETE') {
      if (user.primary) return json(res, 400, { error: 'The owner account cannot be deleted here.' });
      const b = await readBody(req);
      if (b.confirm !== 'DELETE') return json(res, 400, { error: 'Type DELETE to confirm.' });
      store.removeUserData(uid); store.forgetUserChannels(uid); auth.deleteUser(uid);
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      return json(res, 200, { ok: true });
    }

    // ---- admin ----
    if (p === '/api/admin' && req.method === 'GET') { if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators see this.' }); return json(res, 200, adminView(user)); }
    if (p === '/api/admin/settings' && req.method === 'POST') {
      if (!user.primary) return json(res, 403, { error: 'Only the owner changes these.' });
      const b = await readBody(req);
      const patch = {};
      if (['open', 'invite', 'paid'].includes(b.access)) patch.access = b.access;
      if (Number(b.priceCents) >= 100 && Number(b.priceCents) <= 100000) patch.priceCents = Math.round(Number(b.priceCents));
      if (/^[a-z]{3}$/.test(String(b.currency || ''))) patch.currency = b.currency;
      if (typeof b.productName === 'string' && b.productName.trim()) patch.productName = b.productName.trim().slice(0, 80);
      if (b.models && typeof b.models === 'object') { const m = { ...store.settings().models }; for (const k of ['tag', 'ask']) if (['haiku', 'sonnet', 'opus'].includes(b.models[k])) m[k] = b.models[k]; patch.models = m; }
      return json(res, 200, { settings: store.setSettings(patch) });
    }
    if (p === '/api/admin/secret' && req.method === 'POST') {
      if (!user.primary) return json(res, 403, { error: 'Only the owner changes keys.' });
      const b = await readBody(req);
      try { secrets.set(b.name, b.value); return json(res, 200, { secrets: secrets.overview() }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (p === '/api/admin/invite' && req.method === 'POST') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators invite people.' });
      if (auth.limited(`invite:${uid}`, 40, 24 * 3600 * 1000)) return json(res, 429, { error: 'That is a lot of invitations today.' });
      const b = await readBody(req);
      try {
        const g = await grantAccount(b.email, b.name, { invitedBy: uid, by: user.firstName || 'The Jot team' });
        if (b.ai === true) auth.setClaude(g.user.id, true);
        return json(res, 200, { sent: g.sent, error: g.error, link: g.sent ? null : g.link, existing: g.existing });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    const pe = p.match(/^\/api\/people\/([a-f0-9]{12})$/);
    if (pe && req.method === 'POST') {
      if (!isAdmin(user)) return json(res, 403, { error: 'Only administrators manage people.' });
      const b = await readBody(req);
      const t = auth.getUser(pe[1]);
      if (!t) return json(res, 404, { error: 'No such person.' });
      try {
        if (b.emailLink) {
          const { token } = auth.relink(t.id);
          const link = `${BASE_URL}/#/reset/${token}`;
          const d = await mail.send({ to: t.email, subject: t.status === 'unverified' ? 'Your Jot invitation' : 'Your Jot sign-in link', text: `Hi ${t.firstName},\n\n${t.status === 'unverified' ? 'Here is your link to join Jot' : 'Here is a link to set your Jot password'} (24 hours):\n\n${link}\n` }).catch((e) => ({ sent: false, error: e.message }));
          return json(res, 200, { sent: !!d.sent, link: d.sent ? null : link });
        }
        if (b.role) { if (!user.primary) return json(res, 403, { error: 'Only the owner makes or removes administrators.' }); auth.setRole(t.id, b.role === 'admin' ? 'admin' : 'user'); }
        if (typeof b.ai === 'boolean') auth.setClaude(t.id, b.ai);
        if (b.remove === true) {
          if (!user.primary) return json(res, 403, { error: 'Only the owner removes people.' });
          if (t.primary) return json(res, 400, { error: 'The owner cannot be removed.' });
          store.removeUserData(t.id); store.forgetUserChannels(t.id); auth.deleteUser(t.id);
        }
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }

    return json(res, 404, { error: 'Not found.' });
  } catch (err) {
    console.error(`${req.method} ${p}: ${err.stack || err.message}`);
    return json(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong on the server.' });
  }
});

auth.ensureAdmin();
if (config.SCHEDULE) { reminders.start(); telegram.loop().catch((e) => console.error(`telegram loop: ${e.message}`)); }
server.listen(PORT, () => console.log(`  Jot on http://localhost:${PORT} (public ${BASE_URL})`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { store.flush(); } catch {} telegram.stop(); server.close(); process.exit(0); });
