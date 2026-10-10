// Pocket Box — the Studio that designs, builds and signs personal agents, and
// serves the Runtime that runs them on the owner's phone.
//
// Zero dependencies (Node 22). Claude Code CLI on the owner's plan does the
// thinking; files under PB_DATA_DIR hold the state.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const auth = require('./lib/auth');
const mail = require('./lib/mail');
const push = require('./lib/push');
const bus = require('./lib/bus');
const store = require('./lib/store');
const room = require('./lib/room');
const crew = require('./lib/crew');
const ws = require('./lib/workspace');
const packages = require('./lib/packages');
const devices = require('./lib/devices');
const settings = require('./lib/settings');
const scheduler = require('./lib/scheduler');
const cloudrun = require('./lib/cloudrun');
const templates = require('./lib/templates');
const plans = require('./lib/plans');
const billing = require('./lib/billing');
const shares = require('./lib/shares');
const telegram = require('./lib/telegram');
const mineCount = (userId) => store.listAgents().filter((x) => x.ownerId === userId).length;
const prefs = require('./lib/prefs');
const { deliver } = require('./lib/deliver');
const { cleanInputs } = require('./lib/kit/core');

/** After any run (phone or cloud): remember it on the agent and tell open Studio screens. */
function afterRun(agentId, run) {
  const a = store.loadAgent(agentId);
  if (!a) return;
  const fresh = store.patch(agentId, { lastRun: { at: run.at, ok: run.ok, channel: run.channel, where: run.deviceName, summary: run.notifications[0] ? run.notifications[0].title : run.ok ? 'Ran, nothing to say' : 'Failed' } });
  bus.publish(fresh || a, { event: 'run', run });
}
const { askClaude } = require('./lib/claude');
const { PERMISSIONS } = require('./lib/kit/core');

const { PORT, BASE_URL } = config;
const PUBLIC_DIR = path.join(__dirname, 'public');
const KIT_CORE = path.join(__dirname, 'lib', 'kit', 'core.js');
const COOKIE = 'pb_session';

// ---- helpers ------------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readRaw(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      data += c;
      // Settle first, then drop the connection, so the request never hangs.
      if (data.length > limit) { done = true; reject(Object.assign(new Error('That request is too large.'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => { if (!done) { done = true; resolve(data); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
    req.on('close', () => { if (!done) { done = true; reject(new Error('The request was cut off.')); } });
  });
}
async function readBody(req, limit = 1e6) {
  const data = await readRaw(req, limit);
  try { return data ? JSON.parse(data) : {}; } catch { throw Object.assign(new Error('That request is not valid JSON.'), { status: 400 }); }
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
const sessionCookie = (req, value, maxAge) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}`;
// X-Forwarded-For is only believed when it came through our own proxy. Walking
// from the right, the first address that is not a proxy we run is the client;
// anything further left was written by the client and could be made up.
const OUR_PROXIES = new Set(['2.25.157.104', '69.62.86.166', ...String(process.env.PB_TRUSTED_PROXIES || '').split(',').map((s) => s.trim()).filter(Boolean)]);
const isOurs = (ip) => {
  ip = String(ip || '').replace(/^::ffff:/, '');
  return OUR_PROXIES.has(ip) || ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fd|fc)/i.test(ip);
};
const clientIp = (req) => {
  const peer = String(req.socket.remoteAddress || '');
  if (!isOurs(peer)) return peer.replace(/^::ffff:/, '');
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!isOurs(hops[i]) || i === 0) return hops[i].replace(/^::ffff:/, '');
  return peer.replace(/^::ffff:/, '');
};
const currentUser = (req) => auth.userForSession(cookies(req)[COOKIE]);
const isAdmin = (u) => !!u && u.role === 'admin';
const isMember = (u, a) => !!a && !!u && (a.members || []).some((m) => m.userId === u.id);
const canSee = (u, a) => !!a && (isAdmin(u) || a.ownerId === u.id || isMember(u, a));
const canManage = (u, a) => !!a && (isAdmin(u) || a.ownerId === u.id);

const CSP_APP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
// The worker that runs an agent's code: it may compile that code, and nothing
// else — no network at all. Its only way out is the Runtime's message channel.
const CSP_AGENT_WORKER = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(self), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP_APP);
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function crossSiteWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const origin = req.headers.origin || (req.headers.referer ? (() => { try { return new URL(req.headers.referer).origin; } catch { return 'x:'; } })() : '');
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  try { return new URL(origin).host !== host; } catch { return true; }
}

// ---- static files ----------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const APP_VERSION = (() => {
  const h = crypto.createHash('sha256');
  for (const f of fs.readdirSync(PUBLIC_DIR)) { try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch {} }
  try { h.update(fs.readFileSync(KIT_CORE)); } catch {}
  return h.digest('hex').slice(0, 12);
})();

function serveStatic(req, res, p) {
  let rel = p === '/' ? '/index.html' : p === '/runtime' || p === '/runtime/' ? '/runtime.html' : p;
  let file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (rel === '/agent-core.js') file = KIT_CORE;
  else if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(404); return res.end('not found'); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const ext = path.extname(file);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache', 'X-App-Version': APP_VERSION };
  if (rel === '/agent-worker.js' || rel === '/agent-core.js') headers['Content-Security-Policy'] = CSP_AGENT_WORKER;
  // Some browsers apply the page's policy to its workers; the Runtime page
  // itself never evaluates strings, it only lets its agent worker compile code.
  if (rel === '/runtime.html') headers['Content-Security-Policy'] = CSP_APP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'");
  if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/';
  res.writeHead(200, headers);
  if (ext === '.html') {
    return res.end(fs.readFileSync(file, 'utf8').replace(/(src|href)="([a-z-]+\.(?:js|css))"/g, `$1="$2?v=${APP_VERSION}"`));
  }
  fs.createReadStream(file).pipe(res);
}

// ---- views ----------------------------------------------------------------------
function agentView(a, user) {
  const rec = packages.load(a.id);
  const manifest = rec?.package?.manifest;
  const owner = isAdmin(user) && a.ownerId !== user.id ? auth.getUser(a.ownerId) : null;
  return {
    ...a,
    shareCode: canManage(user, a) ? shares.codeFor(a.id) : null,
    ownerName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : null,
    running: bus.running(a.id), thinking: bus.thinking(a.id), needsYou: store.needsYou(a),
    runsOn: a.runsOn || 'phone', cloudRunning: cloudrun.isRunning(a.id), notifyStyle: a.notifyStyle || 'normal',
    role: a.ownerId === user.id ? 'owner' : isMember(user, a) ? 'member' : 'admin',
    members: (a.members || []).map((m) => { const x = auth.getUser(m.userId); return x ? { userId: x.id, name: `${x.firstName} ${x.lastName}`.trim(), email: x.email } : null; }).filter(Boolean),
    invites: a.ownerId === user.id ? (a.invites || []) : [],
    ownerFirstName: (auth.getUser(a.ownerId) || {}).firstName || '',
    inputs: ((manifest?.triggers || []).find((t) => t.type === 'manual' && Array.isArray(t.inputs)) || {}).inputs || [],
    package: rec ? { version: manifest.version, channel: rec.channel, publishedAt: rec.publishedAt, permissions: manifest.permissions, triggers: manifest.triggers, http: manifest.http || null, evals: rec.package.evals, history: rec.history, commit: rec.package.commit } : null,
    settings: manifest ? settings.view(a.id, manifest) : [],
  };
}

// ---- server ------------------------------------------------------------------------
const PUBLIC_API = new Set(['/api/session', '/api/login', '/api/logout', '/api/signup', '/api/forgot', '/api/reset', '/api/stripe/webhook']);

async function sendSetPasswordMail(u, token, reason) {
  const link = `${BASE_URL}/#/reset/${token}`;
  const text = reason === 'approved'
    ? `Hi ${u.firstName},\n\nYour access to Pocket Box was approved. Set your password here (one use, 24 hours):\n\n${link}\n`
    : `Hi ${u.firstName},\n\nUse this link to set a new Pocket Box password (one use, 24 hours):\n\n${link}\n\nIf you did not ask for this, ignore this email.\n`;
  const r = await mail.send({ to: u.email, subject: reason === 'approved' ? 'Your Pocket Box access is approved' : 'Reset your Pocket Box password', text });
  return { ...r, link };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  securityHeaders(req, res);
  try {
    if (p.startsWith('/api/') && crossSiteWrite(req)) return json(res, 403, { error: 'Cross-site request refused.' });
    const ip = clientIp(req);

    // ---- Stripe tells us about payments (signed; no session) ----
    if (p === '/api/stripe/webhook' && req.method === 'POST') {
      const raw = await readRaw(req);
      if (!billing.verify(raw, req.headers['stripe-signature'])) return json(res, 400, { error: 'Bad signature.' });
      let event; try { event = JSON.parse(raw); } catch { return json(res, 400, { error: 'Bad JSON.' }); }
      const what = await billing.apply(event).catch((e) => `failed: ${e.message}`);
      console.log(`stripe ${event.type}: ${what}`);
      bus.broadcast({ event: 'users' }, { adminsOnly: true });
      return json(res, 200, { received: true });
    }
    // ---- a native app pairing with a code from the Studio (no token yet) ----
    if (p === '/api/device/pair-code' && req.method === 'POST') {
      if (auth.limited(`paircode:ip:${ip}`, 10, 10 * 60 * 1000)) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      const b = await readBody(req).catch(() => ({}));
      const r = devices.redeemCode(b.code, auth.getUser, { name: b.name, tz: b.tz, ua: req.headers['user-agent'], platform: b.platform });
      if (!r) return json(res, 400, { error: 'That code is wrong or expired. Make a new one in the Studio under Your phones.' });
      return json(res, 200, { ...r, publicKey: packages.publicKey() });
    }
    // ---- device API (bearer token from a paired phone) ----
    if (p.startsWith('/api/device/')) return deviceApi(req, res, p, url);

    // ---- public: session and accounts ----
    if (p === '/api/session' && req.method === 'GET') {
      const u = currentUser(req);
      return json(res, 200, { authed: !!u, user: auth.publicUser(u), version: APP_VERSION, mailConfigured: mail.configured(), openSignup: config.OPEN_SIGNUP });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      try {
        const u = auth.login({ email: body.email, password: body.password, ip });
        res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(u, req.headers['user-agent']), 30 * 24 * 3600));
        return json(res, 200, { ok: true, user: auth.publicUser(u) });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Sign-in failed.' }); }
    }
    if (p === '/api/logout' && req.method === 'POST') {
      auth.destroySession(cookies(req)[COOKIE]);
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/signup' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      try {
        const { user, duplicate, token } = auth.signup({ ...body, ip });
        if (!duplicate && token) {
          // Open sign-up: the set-password link is the email check.
          mail.send({ to: user.email, subject: 'Set your Pocket Box password', text: `Hi ${user.firstName},\n\nWelcome to Pocket Box. Set your password with this link (one use, 24 hours) and you're in:\n\n${BASE_URL}/#/reset/${token}\n\nIf you didn't sign up, ignore this email and nothing happens.\n` }).catch(() => {});
          for (const ad of auth.admins()) mail.send({ to: ad.email, subject: `New Pocket Box sign-up: ${user.firstName} ${user.lastName}`, text: `${user.firstName} ${user.lastName} (${user.email}, ${user.phone}) signed up. No action needed; you can disable the account under People: ${BASE_URL}/#/people\n` }).catch(() => {});
          bus.broadcast({ event: 'users' }, { adminsOnly: true });
        } else if (!duplicate) {
          push.broadcast({ title: 'Access request', body: `${user.firstName} ${user.lastName} asked to join Pocket Box.`, url: '/#/people', tag: `signup:${user.id}` }, auth.admins().map((x) => x.id)).catch(() => {});
          for (const ad of auth.admins()) mail.send({ to: ad.email, subject: `Pocket Box access request: ${user.firstName} ${user.lastName}`, text: `${user.firstName} ${user.lastName} (${user.email}, ${user.phone}) asked for access.\n\nApprove in Pocket Box → People: ${BASE_URL}/#/people\n` }).catch(() => {});
          mail.send({ to: user.email, subject: 'We got your Pocket Box request', text: `Hi ${user.firstName},\n\nThanks for asking to join Pocket Box. The administrator reviews each request; once yours is approved you'll get another email with a link to set your password.\n\n${BASE_URL}\n` }).catch(() => {});
        } else if (user.status === 'approved') {
          // Already has an account: tell the inbox owner, with a reset link.
          // The screen says the same either way, so nobody learns who has an account.
          const r = auth.forgot({ email: user.email, ip });
          const link = r ? `\n\nForgot it? Set a new password here (one use, 24 hours):\n${BASE_URL}/#/reset/${r.token}` : '';
          mail.send({ to: user.email, subject: 'You already have a Pocket Box account', text: `Hi ${user.firstName},\n\nSomeone (probably you) asked to create a Pocket Box account with this email, but you already have one. Sign in at ${BASE_URL}${link}\n\nIf this wasn't you, you can ignore this email.\n` }).catch(() => {});
        } else if (user.status === 'unverified') {
          const r = auth.forgot({ email: user.email, ip });
          if (r) mail.send({ to: user.email, subject: 'Set your Pocket Box password', text: `Hi ${user.firstName},\n\nHere's a fresh link to set your Pocket Box password (one use, 24 hours):\n\n${BASE_URL}/#/reset/${r.token}\n` }).catch(() => {});
        } else if (user.status === 'pending') {
          mail.send({ to: user.email, subject: 'Your Pocket Box request is waiting for approval', text: `Hi ${user.firstName},\n\nYour request to join Pocket Box is still waiting for the administrator. You'll get an email with a link to set your password once it's approved.\n` }).catch(() => {});
        }
        return json(res, 200, { ok: true, message: config.OPEN_SIGNUP ? 'Check your email: we sent a link to set your password. It works once, for 24 hours. (Check Spam if it isn\'t there in a minute.)' : 'Thanks! Check your email for a confirmation. Once the administrator approves your request, you will get a link to set your password.' });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Could not send the request.' }); }
    }
    if (p === '/api/forgot' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      try {
        const r = auth.forgot({ email: body.email, ip });
        if (r) sendSetPasswordMail(r.user, r.token, 'reset').catch(() => {});
        return json(res, 200, { ok: true, message: 'If that address has an approved account, a reset link is on its way.' });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (p === '/api/reset' && req.method === 'GET') {
      const u = auth.tokenUser(url.searchParams.get('token'));
      return json(res, 200, { valid: !!u, email: u?.email || null });
    }
    if (p === '/api/reset' && req.method === 'POST') {
      const body = await readBody(req).catch(() => ({}));
      if (auth.limited(`reset:ip:${ip}`, 10, 3600 * 1000)) return json(res, 429, { error: 'Too many attempts.' });
      try { const u = auth.resetPassword({ token: body.token, password: body.password }); return json(res, 200, { ok: true, email: u.email }); }
      catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }

    const user = p.startsWith('/api/') ? currentUser(req) : null;
    if (p.startsWith('/api/') && !user && !PUBLIC_API.has(p)) return json(res, 401, { error: 'Sign in to continue.', login: true });
    if (p.startsWith('/api/')) return await studioApi(req, res, p, url, user);
    return serveStatic(req, res, p);
  } catch (err) {
    console.error(`${req.method} ${p}: ${err.stack || err.message}`);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' });
  }
});

async function studioApi(req, res, p, url, user) {
  if (p === '/api/password' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    try { auth.changePassword(user, { current: body.current, next: body.next, sessionToken: cookies(req)[COOKIE] }); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ event: 'hello', version: APP_VERSION })}\n\n`);
    bus.attach(res, cookies(req)[COOKIE]);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); bus.detach(res); });
    return;
  }
  if (p === '/api/meta' && req.method === 'GET') {
    return json(res, 200, {
      templates: Object.entries(room.TEMPLATES).map(([id, t]) => ({ id, ...t })),
      room: [{ id: 'orchestrator', ...pick(room.EXPERTS.orchestrator) }, ...room.ROSTER.map((id) => ({ id, ...pick(room.EXPERTS[id]) }))],
      crew: Object.entries(crew.CREW).map(([id, c]) => ({ id, name: c.name, emoji: c.emoji })),
      permissions: PERMISSIONS, publicKey: packages.publicKey(),
    });
  }
  if (p === '/api/me/plan' && req.method === 'GET') {
    const plan = plans.planOf(user);
    return json(res, 200, {
      plan: { ...plan, builds: Number.isFinite(plan.builds) ? plan.builds : null, agents: Number.isFinite(plan.agents) ? plan.agents : null, spendUsd: Number.isFinite(plan.spendUsd) ? plan.spendUsd : null },
      usage: plans.usage(user.id), agents: mineCount(user.id), payments: billing.configured(), hasSubscription: !!user.stripeCustomer,
      plans: Object.entries(plans.PLANS).map(([id, x]) => ({ id, ...x, buyable: id !== 'free' && !!billing.priceFor(id) })),
    });
  }
  if (p === '/api/billing/checkout' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    try { return json(res, 200, { url: await billing.checkout(user, String(b.plan || '')) }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  if (p === '/api/billing/portal' && req.method === 'POST') {
    try { return json(res, 200, { url: await billing.portal(user) }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  if (p === '/api/me/export' && req.method === 'GET') {
    const mine = store.listAgents().filter((x) => x.ownerId === user.id);
    const out = {
      exportedAt: new Date().toISOString(), account: auth.publicUser(user), preferences: prefs.get(user.id), aboutMe: room.aboutMe(user.id),
      devices: devices.list(user.id),
      agents: mine.map((a) => { const rec = packages.load(a.id); return { id: a.id, title: a.title, stage: a.stage, createdAt: a.createdAt, brief: a.brief, plan: a.plan, messages: a.messages, package: rec ? rec.package : null, channel: rec ? rec.channel : null, settings: rec ? settings.view(a.id, rec.package.manifest) : [], runs: devices.runs(a.id, 500) }; }),
    };
    const body = JSON.stringify(out, null, 1);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="pocket-box-export.json"', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }
  if (p === '/api/me/delete' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    if (user.primary) return json(res, 400, { error: 'The primary administrator can\'t delete this account.' });
    try { auth.login({ email: user.email, password: b.password, ip: clientIp(req) }); } catch { return json(res, 400, { error: 'That password isn\'t right.' }); }
    for (const a of store.listAgents().filter((x) => x.ownerId === user.id)) { bus.stop(a.id); try { packages.setChannel(a.id, 'off'); } catch {} shares.revoke(a.id); store.deleteAgent(a.id); }
    for (const d of devices.list(user.id)) devices.revoke(user.id, d.id);
    telegram.unlink(user.id);
    auth.deleteUser(user.id);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    return json(res, 200, { ok: true });
  }
  if (p === '/api/me/telegram' && req.method === 'GET') return json(res, 200, telegram.status(user.id));
  if (p === '/api/me/telegram' && req.method === 'POST') {
    const url = telegram.linkFor(user.id);
    return url ? json(res, 200, { url }) : json(res, 409, { error: 'Telegram isn\'t set up on this Pocket Box yet.' });
  }
  if (p === '/api/me/telegram' && req.method === 'DELETE') { telegram.unlink(user.id); return json(res, 200, telegram.status(user.id)); }
  if (p === '/api/me/prefs') {
    if (req.method === 'GET') return json(res, 200, { prefs: prefs.get(user.id), mailConfigured: mail.configured() });
    if (req.method === 'POST') { const b = await readBody(req).catch(() => ({})); return json(res, 200, { prefs: prefs.set(user.id, b) }); }
  }
  if (p === '/api/me/about') {
    if (req.method === 'GET') return json(res, 200, { about: room.aboutMe(user.id) });
    if (req.method === 'POST') { const b = await readBody(req).catch(() => ({})); room.setAboutMe(user.id, b.about); return json(res, 200, { ok: true }); }
  }

  // ---- administration ----
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(user)) return json(res, 403, { error: 'Administrators only.' });
    if (p === '/api/admin/users' && req.method === 'GET') return json(res, 200, { users: auth.listUsers(), mailConfigured: mail.configured() });
    const pm = p.match(/^\/api\/admin\/users\/([a-f0-9]+)\/plan$/);
    if (pm && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (!plans.PLANS[b.plan]) return json(res, 400, { error: 'Unknown plan.' });
      const u = auth.setPlan(pm[1], { plan: b.plan });
      bus.broadcast({ event: 'users' }, { adminsOnly: true });
      return u ? json(res, 200, { ok: true }) : json(res, 404, { error: 'No such user.' });
    }
    const m = p.match(/^\/api\/admin\/users\/([a-f0-9]+)\/(approve|decline|disable|enable|resend|make-admin|remove-admin)$/);
    if (m && req.method === 'POST') {
      const [, id, act] = m;
      try {
        if (act === 'make-admin' || act === 'remove-admin') {
          if (!user.primary) return json(res, 403, { error: 'Only the primary administrator can change roles.' });
          auth.setRole(id, act === 'make-admin' ? 'admin' : 'user');
          bus.broadcast({ event: 'users' }, { adminsOnly: true });
          return json(res, 200, { ok: true });
        }
        if (id === user.id) return json(res, 400, { error: 'You cannot change your own account here.' });
        const target = auth.getUser(id);
        if (!target) return json(res, 404, { error: 'No such user.' });
        // Nobody acts on the primary administrator here, and only the primary acts on other administrators.
        if (target.primary || (target.role === 'admin' && !user.primary)) return json(res, 403, { error: 'Only the primary administrator can change another administrator.' });
        if (act === 'approve' || act === 'resend') {
          // A set-password link is shown on screen only for someone who has never set a password;
          // for an existing account it goes by email only, so it cannot be used to take the account over.
          const fresh = !target.hash;
          const { user: u, token } = auth.approve(id);
          const r = await sendSetPasswordMail(u, token, 'approved');
          bus.broadcast({ event: 'users' }, { adminsOnly: true });
          return json(res, 200, { ok: true, emailed: r.sent, link: r.sent || !fresh ? null : r.link });
        }
        if (act === 'decline') auth.decline(id);
        else auth.setStatus(id, act === 'disable' ? 'disabled' : 'approved');
        bus.broadcast({ event: 'users' }, { adminsOnly: true });
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    return json(res, 404, { error: 'not found' });
  }

  // ---- push (Studio notifications and agent wake-ups) ----
  if (p === '/api/push/key' && req.method === 'GET') return json(res, 200, { publicKey: push.publicKey(), devices: push.count(user.id) });
  if (p === '/api/push/subscribe' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    try { push.subscribe(b.subscription, { userId: user.id, ua: req.headers['user-agent'] }); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }

  // ---- phones ----
  if (p === '/api/devices' && req.method === 'GET') return json(res, 200, { devices: devices.list(user.id) });
  if (p === '/api/devices/pair' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    if (auth.limited(`pair:${user.id}`, 10, 3600 * 1000)) return json(res, 429, { error: 'Too many pairings in an hour.' });
    try { const r = devices.pair(user, { name: b.name, tz: b.tz, ua: req.headers['user-agent'], platform: b.platform }); return json(res, 200, { ...r, publicKey: packages.publicKey() }); }
    catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  if (p === '/api/devices/code' && req.method === 'POST') {
    if (auth.limited(`paircode:${user.id}`, 20, 3600 * 1000)) return json(res, 429, { error: 'Too many codes in an hour.' });
    return json(res, 200, devices.createCode(user));
  }
  const dm = p.match(/^\/api\/devices\/([a-f0-9]{12})$/);
  if (dm && req.method === 'DELETE') return json(res, devices.revoke(user.id, dm[1], { admin: isAdmin(user) }) ? 200 : 404, { ok: true });

  // ---- ready-made agents ----
  if (p === '/api/templates' && req.method === 'GET') return json(res, 200, { templates: templates.list() });
  const tm = p.match(/^\/api\/templates\/([a-z0-9-]+)\/install$/);
  if (tm && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    if (auth.limited(`install:${user.id}`, 30, 3600 * 1000)) return json(res, 429, { error: 'Too many installs in an hour.' });
    const slot = plans.canAddAgent(user, mineCount(user.id));
    if (!slot.ok) return json(res, 402, { error: slot.reason, upgrade: true });
    try {
      const a = await templates.install(user, tm[1], { values: b.values || {}, when: b.when || {}, live: b.live !== false, title: b.title, runsOn: b.runsOn });
      return json(res, 201, agentView(a, user));
    } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }

  // ---- shared links: a copy of someone's agent ----
  const sm = p.match(/^\/api\/shares\/([\w-]{8,20})(?:\/(install))?$/);
  if (sm && req.method === 'GET' && !sm[2]) {
    const pv = shares.preview(sm[1]);
    return pv ? json(res, 200, pv) : json(res, 404, { error: 'This link no longer works.' });
  }
  if (sm && sm[2] && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    if (auth.limited(`install:${user.id}`, 30, 3600 * 1000)) return json(res, 429, { error: 'Too many installs in an hour.' });
    const slot = plans.canAddAgent(user, mineCount(user.id));
    if (!slot.ok) return json(res, 402, { error: slot.reason, upgrade: true });
    try {
      const a = await shares.install(user, sm[1], { live: b.live === true, runsOn: b.runsOn });
      return json(res, 201, agentView(a, user));
    } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }

  // ---- agents ----
  if (p === '/api/agents' && req.method === 'GET') {
    // Invitations by email turn into membership once that person has an account.
    for (const a of store.listAgents()) {
      if ((a.invites || []).includes(user.email)) {
        store.patch(a.id, (x) => {
          x.invites = (x.invites || []).filter((e) => e !== user.email);
          x.members = [...(x.members || []).filter((m) => m.userId !== user.id), { userId: user.id, addedAt: Date.now() }];
        });
      }
    }
    return json(res, 200, { agents: store.listAgents().filter((a) => canSee(user, a)).map((a) => ({ ...store.summary(a), running: bus.running(a.id), mine: a.ownerId === user.id, shared: isMember(user, a) })) });
  }
  if (p === '/api/agents' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    if (!String(b.idea || '').trim()) return json(res, 400, { error: 'Describe the agent you want.' });
    if (auth.limited(`create:${user.id}`, 30, 3600 * 1000)) return json(res, 429, { error: 'Too many new agents in an hour.' });
    const can = plans.canBuild(user);
    if (!can.ok) return json(res, 402, { error: can.reason, upgrade: !!can.upgrade });
    const slot = plans.canAddAgent(user, mineCount(user.id));
    if (!slot.ok) return json(res, 402, { error: slot.reason, upgrade: true });
    const a = store.createAgent({ ownerId: user.id, idea: b.idea, template: room.TEMPLATES[b.template] ? b.template : null, rounds: b.rounds });
    plans.recordBuild(user.id);
    room.runRoom(a);
    return json(res, 201, agentView(store.loadAgent(a.id), user));
  }
  const am = p.match(/^\/api\/agents\/([a-f0-9]{12})(?:\/([a-z-]+))?(?:\/([a-f0-9]{10,12}))?(?:\/([a-z]+))?$/);
  if (!am) return json(res, 404, { error: 'not found' });
  const [, id, action, sub, subAction] = am;
  let a = store.loadAgent(id);
  if (!canSee(user, a)) return json(res, 404, { error: 'No such agent.' });
  // People it is shared with may look, see its runs, run it, and leave.
  const memberOnly = !canManage(user, a);
  const memberMay = (!action && req.method === 'GET') || (action === 'runs' && req.method === 'GET' && !sub) || (action === 'run' && req.method === 'POST')
    || (action === 'members' && req.method === 'DELETE' && sub === user.id);
  if (memberOnly && !memberMay) return json(res, 403, { error: 'Only the agent\'s owner can do that.' });

  if (!action && req.method === 'GET') return json(res, 200, agentView(a, user));
  if (!action && req.method === 'PATCH') {
    const b = await readBody(req).catch(() => ({}));
    if (b.title) { a.title = String(b.title).slice(0, 40); store.saveAgent(a); }
    return json(res, 200, agentView(a, user));
  }
  if (!action && req.method === 'DELETE') {
    bus.stop(a.id);
    try { packages.setChannel(a.id, 'off'); } catch {}
    shares.revoke(a.id);
    store.deleteAgent(a.id);
    bus.publish(a, { event: 'deleted' });
    return json(res, 200, { ok: true });
  }
  if (action === 'message' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    const text = String(b.text || '').trim().slice(0, 4000);
    if (!text) return json(res, 400, { error: 'Write something first.' });
    const spend = plans.canSpend(auth.getUser(a.ownerId));
    if (!spend.ok) return json(res, 402, { error: spend.reason, upgrade: !!spend.upgrade });
    const msg = store.addMessage(a, { agentId: 'owner', agentName: 'You', kind: 'owner', summary: text.slice(0, 160), content: text });
    store.saveAgent(a);
    bus.publish(a, { event: 'message', message: msg });
    crew.onOwnerMessage(store.loadAgent(a.id), text).catch((e) => console.error(`note ${a.id}: ${e.message}`));
    return json(res, 201, msg);
  }
  if (['build', 'approve', 'resume'].includes(action) && req.method === 'POST') {
    const spend = plans.canSpend(auth.getUser(a.ownerId));
    if (!spend.ok) return json(res, 402, { error: spend.reason, upgrade: !!spend.upgrade });
  }
  if (action === 'build' && req.method === 'POST') {
    if (!a.brief) return json(res, 409, { error: 'The room has not written the brief yet.' });
    if (bus.running(a.id)) return json(res, 409, { error: 'Wait for the current step to finish.' });
    crew.runPlanning(a);
    return json(res, 202, { ok: true });
  }
  if (action === 'approve' && req.method === 'POST') {
    if (a.stage !== 'plan_review') return json(res, 409, { error: 'There is no plan waiting for approval.' });
    a.planApprovedAt = Date.now();
    a.stage = 'building';
    store.saveAgent(a);
    crew.runBuild(a);
    return json(res, 202, { ok: true });
  }
  if (action === 'resume' && req.method === 'POST') {
    if (bus.running(a.id)) return json(res, 409, { error: 'Already working.' });
    try { crew.resume(a); return json(res, 202, { ok: true }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  if (action === 'pause' && req.method === 'POST') { bus.stop(a.id); return json(res, 202, { ok: true }); }
  if (action === 'members' && req.method === 'POST' && !sub) {
    if (a.ownerId !== user.id) return json(res, 403, { error: 'Only the agent\'s owner can share it.' });
    const b = await readBody(req).catch(() => ({}));
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 400, { error: 'Enter an email address.' });
    if (email === user.email) return json(res, 400, { error: 'That\'s you.' });
    const limit = plans.planOf(user).members;
    const count = (a.members || []).length + (a.invites || []).length;
    if (count >= limit) return json(res, 402, { error: limit ? `Your plan shares an agent with up to ${limit} people.` : 'Sharing comes with the Family and Business plans.', upgrade: true });
    const target = auth.listUsers().find((x) => x.email === email && x.status === 'approved');
    a = store.patch(a.id, (x) => {
      x.members = x.members || []; x.invites = x.invites || [];
      if (target) { if (!x.members.some((m) => m.userId === target.id)) x.members.push({ userId: target.id, addedAt: Date.now() }); }
      else if (!x.invites.includes(email)) x.invites.push(email);
    });
    mail.send({ to: email, subject: `${user.firstName} shared "${a.title}" with you on Pocket Box`, text: target
      ? `Hi ${target.firstName},\n\n${user.firstName} ${user.lastName} shared the agent "${a.title}" with you. You'll get its notifications, and you can run it from Pocket Box.\n\n${BASE_URL}/#/a/${a.id}\n`
      : `Hi,\n\n${user.firstName} ${user.lastName} shared the agent "${a.title}" with you on Pocket Box. Create a free account with this email to get its notifications:\n\n${BASE_URL}/#/signup\n` }).catch(() => {});
    return json(res, 200, agentView(a, user));
  }
  if (action === 'members' && req.method === 'DELETE' && sub) {
    a = store.patch(a.id, (x) => { x.members = (x.members || []).filter((m) => m.userId !== sub); });
    return json(res, 200, a.ownerId === user.id ? agentView(a, user) : { ok: true });
  }
  if (action === 'invites' && req.method === 'DELETE') {
    const email = String(url.searchParams.get('email') || '').toLowerCase();
    a = store.patch(a.id, (x) => { x.invites = (x.invites || []).filter((e) => e !== email); });
    return json(res, 200, agentView(a, user));
  }
  if (action === 'quick' && req.method === 'POST') {
    if (a.ownerId !== user.id) return json(res, 403, { error: 'Only the agent\'s owner can change it.' });
    if (!bus.start(a.id)) return json(res, 409, { error: 'Wait for the current step to finish.' });
    try {
      const b = await readBody(req).catch(() => ({}));
      const done = await crew.quickEdit(a, { at: b.at, days: b.days, minutes: b.minutes });
      if (done.length) {
        const msg = store.addMessage(a, { agentId: 'system', agentName: 'Pocket Box', emoji: '📦', kind: 'system', summary: done.join(' ').slice(0, 160), content: done.join(' ') });
        store.saveAgent(a);
        bus.publish(a, { event: 'message', message: msg });
      }
      return json(res, 200, { ...agentView(store.loadAgent(a.id), user), changed: done });
    } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    finally { bus.finish(a.id); }
  }
  if (action === 'share' && req.method === 'POST') {
    if (a.ownerId !== user.id) return json(res, 403, { error: 'Only the agent\'s owner can share a copy.' });
    if (!packages.load(a.id)) return json(res, 409, { error: 'It has to be built before it can be shared.' });
    const code = shares.create(a, user);
    return json(res, 200, { code, url: `${BASE_URL}/#/s/${code}` });
  }
  if (action === 'share' && req.method === 'DELETE') {
    if (a.ownerId !== user.id) return json(res, 403, { error: 'Only the agent\'s owner can stop sharing.' });
    shares.revoke(a.id);
    return json(res, 200, { ok: true });
  }
  if (action === 'style' && req.method === 'POST') {
    if (a.ownerId !== user.id) return json(res, 403, { error: 'Only the agent\'s owner chooses how it notifies.' });
    const b = await readBody(req).catch(() => ({}));
    if (!['normal', 'quiet', 'urgent', 'digest'].includes(b.style)) return json(res, 400, { error: 'Choose normal, quiet, urgent or digest.' });
    a = store.patch(a.id, { notifyStyle: b.style });
    return json(res, 200, agentView(a, user));
  }
  if (action === 'where' && req.method === 'POST') {
    if (a.ownerId !== user.id) return json(res, 403, { error: 'Only the agent\'s owner chooses where it runs.' });
    const b = await readBody(req).catch(() => ({}));
    if (!['phone', 'cloud'].includes(b.runsOn)) return json(res, 400, { error: 'Choose phone or cloud.' });
    a = store.patch(a.id, { runsOn: b.runsOn });
    return json(res, 200, agentView(a, user));
  }
  if (action === 'snooze' && req.method === 'POST') {
    if (a.ownerId !== user.id) return json(res, 403, { error: 'Only the agent\'s owner can snooze it.' });
    const b = await readBody(req).catch(() => ({}));
    const minutes = b.until === 'off' ? 0 : b.until === 'today' ? null : Math.min(Math.max(Number(b.minutes) || 60, 15), 7 * 24 * 60);
    let until = minutes ? Date.now() + minutes * 60000 : null;
    if (b.until === 'today') { const d = new Date(); d.setHours(23, 59, 0, 0); until = d.getTime(); }
    a = store.patch(a.id, { snoozeUntil: until });
    return json(res, 200, agentView(a, user));
  }
  if (action === 'run' && req.method === 'POST') {
    const rec = packages.load(a.id);
    if (!rec) return json(res, 409, { error: 'It has to be built first.' });
    if (rec.channel === 'off') return json(res, 409, { error: 'It is switched off. Turn it on first.' });
    const missing = settings.missing(a.id, rec.package.manifest);
    if (missing.length) return json(res, 409, { error: `It needs your settings first: ${missing.join(', ')}.` });
    if (cloudrun.isRunning(a.id)) return json(res, 409, { error: 'It is running right now.' });
    const b = await readBody(req).catch(() => ({}));
    const run = await cloudrun.run(a, { type: 'manual', input: cleanInputs(rec.package.manifest, b.input), by: user.firstName }, { onRun: (r) => afterRun(a.id, r) });
    return run ? json(res, 200, { run }) : json(res, 409, { error: 'It could not run just now.' });
  }
  if (action === 'channel' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    if (!['live', 'shadow', 'off'].includes(b.channel)) return json(res, 400, { error: 'Channel is live, shadow or off.' });
    try {
      const rec = packages.setChannel(a.id, b.channel);
      a.release = { ...(a.release || {}), channel: rec.channel };
      a.stage = b.channel === 'live' ? 'live' : 'shadow';
      const msg = store.addMessage(a, { agentId: 'system', agentName: 'Pocket Box', emoji: '📦', kind: 'system', summary: b.channel === 'live' ? 'Live on your phones' : b.channel === 'off' ? 'Switched off on your phones' : 'Back in shadow mode', content: b.channel === 'live' ? 'It now acts for real: notifications are shown, not just recorded.' : b.channel === 'off' ? 'Your phones stop running it the next time the Runtime opens.' : 'It runs, but only records what it would have done.' });
      store.saveAgent(a);
      bus.publish(a, { event: 'message', message: msg });
      return json(res, 200, agentView(a, user));
    } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  }
  if (action === 'settings') {
    const rec = packages.load(a.id);
    if (!rec) return json(res, 409, { error: 'Settings appear once the agent is built.' });
    if (req.method === 'GET') return json(res, 200, { settings: settings.view(a.id, rec.package.manifest) });
    if (req.method === 'POST') {
      if (a.ownerId !== user.id) return json(res, 403, { error: 'Only the agent\'s owner sets its values.' });
      const b = await readBody(req).catch(() => ({}));
      try {
        settings.set(a.id, rec.package.manifest, b.values);
        a.missingSettings = settings.missing(a.id, rec.package.manifest);
        store.saveAgent(a);
        return json(res, 200, { ok: true, settings: settings.view(a.id, rec.package.manifest), missing: a.missingSettings });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
  }
  if (action === 'runs' && req.method === 'GET' && !sub) return json(res, 200, { runs: devices.runs(a.id) });
  if (action === 'runs' && sub && subAction === 'wrong' && req.method === 'POST') {
    const run = devices.runs(a.id, 500).find((r) => r.id === sub);
    if (!run) return json(res, 404, { error: 'No such run.' });
    const spend = plans.canSpend(auth.getUser(a.ownerId));
    if (!spend.ok) return json(res, 402, { error: spend.reason, upgrade: !!spend.upgrade });
    const b = await readBody(req).catch(() => ({}));
    const text = `That run was wrong${b.note ? `: ${String(b.note).slice(0, 1500)}` : '.'}\n\nThe run (${new Date(run.at).toISOString()}, ${run.trigger}, version ${run.version}): ${run.ok ? 'finished' : `failed: ${run.error}`}. ${run.notifications.map((n) => `Notified "${n.title}: ${n.body}"`).join(' ') || 'No notification.'} Log: ${run.log.join(' | ').slice(0, 1500)}`;
    const msg = store.addMessage(a, { agentId: 'owner', agentName: 'You', kind: 'owner', summary: text.slice(0, 160), content: text });
    store.saveAgent(a);
    bus.publish(a, { event: 'message', message: msg });
    if (!bus.running(a.id)) crew.runBuild(store.loadAgent(a.id), { feedback: text });
    return json(res, 202, { ok: true });
  }
  if (action === 'files' && req.method === 'GET') {
    const rel = url.searchParams.get('path');
    if (!rel) return json(res, 200, { files: ws.listFiles(a.id).filter((f) => !f.startsWith('agentkit/')) });
    const text = ws.readFile(a.id, rel);
    return text === null ? json(res, 404, { error: 'No such file.' }) : json(res, 200, { path: rel, text: text.slice(0, 200000) });
  }
  return json(res, 404, { error: 'not found' });
}

function pick(e) { return { name: e.name, emoji: e.emoji, role: e.role }; }

// ---- device API -------------------------------------------------------------------
async function deviceApi(req, res, p, url) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const device = devices.fromToken(token);
  if (!device) return json(res, 401, { error: 'This phone is not paired, or was removed. Pair it again from the Runtime.', unpaired: true });
  const owner = auth.getUser(device.ownerId);
  if (!owner || owner.status !== 'approved') return json(res, 403, { error: 'The account behind this phone is not active.' });
  if (auth.limited(`device:${device.id}`, 600, 3600 * 1000)) return json(res, 429, { error: 'Too many requests from this phone.' });

  const ownAgent = (id) => {
    const a = store.loadAgent(String(id || ''));
    const rec = a && a.ownerId === device.ownerId ? packages.load(a.id) : null;
    return rec && rec.channel !== 'off' ? { a, rec } : null;
  };

  if (p === '/api/device/state' && req.method === 'GET') {
    const list = store.listAgents().filter((a) => a.ownerId === device.ownerId).map((a) => ({ a, rec: packages.load(a.id) })).filter((x) => x.rec);
    return json(res, 200, {
      publicKey: packages.publicKey(), pushKey: push.publicKey(), version: APP_VERSION,
      device: { id: device.id, name: device.name, tz: device.tz },
      owner: { firstName: owner.firstName },
      handoff: { used: devices.handoffUsage(device.ownerId), cap: plans.planOf(owner).handoffsPerDay },
      agents: list.map(({ a, rec }) => ({
        agentId: a.id, title: a.title, icon: a.icon || null, channel: rec.channel, runsOn: a.runsOn || 'phone',
        package: rec.channel === 'off' ? null : rec.package, signature: rec.channel === 'off' ? null : rec.signature,
        settings: settings.values(a.id), missingSettings: settings.missing(a.id, rec.package.manifest),
      })),
    });
  }
  if (p === '/api/device/hello' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    devices.update(device.id, { tz: b.tz, name: b.name });
    if (b.subscription) { try { push.subscribe(b.subscription, { userId: device.ownerId, ua: req.headers['user-agent'] }); } catch {} }
    return json(res, 200, { ok: true });
  }
  if (p === '/api/device/runs' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    const own = ownAgent(b.agentId);
    if (!own) return json(res, 404, { error: 'No such agent on this phone.' });
    const run = devices.recordRun(device, own.a.id, b);
    afterRun(own.a.id, run);
    // The phone showed it already; this only sends the email copy, if wanted.
    deliver(store.loadAgent(own.a.id), run.notifications, { channel: run.channel, viaPush: false }).catch(() => {});
    return json(res, 201, { ok: true, id: run.id });
  }
  if (p === '/api/device/http' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    const own = ownAgent(b.agentId);
    if (!own) return json(res, 404, { error: 'No such agent on this phone.' });
    if (!(own.rec.package.manifest.permissions || []).includes('http')) return json(res, 403, { error: 'This agent may not read the web.' });
    return json(res, 200, await devices.httpGet(own.rec.package.manifest, b.url, settings.values(own.a.id)));
  }
  if (p === '/api/device/webhook' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    const own = ownAgent(b.agentId);
    if (!own) return json(res, 404, { error: 'No such agent on this phone.' });
    const m = own.rec.package.manifest;
    if (!(m.permissions || []).includes('webhook') || !((m.webhook && m.webhook.settings) || []).includes(b.key)) return json(res, 403, { error: 'This agent may not send to that hook.' });
    // Only live, unsnoozed agents send; shadow runs only record what they would have sent.
    if (own.rec.channel !== 'live' || (own.a.snoozeUntil && own.a.snoozeUntil > Date.now())) return json(res, 200, { status: 0, sent: false, held: true });
    if (auth.limited(`webhook:${own.a.id}`, 60, 3600 * 1000)) return json(res, 429, { error: 'Too many webhook messages this hour.' });
    if (JSON.stringify(b.data ?? {}).length > 20000) return json(res, 400, { error: 'A webhook message is over 20 KB.' });
    return json(res, 200, await devices.httpPost(settings.values(own.a.id)[b.key], b.data ?? {}));
  }
  if (p === '/api/device/handoff' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    const own = ownAgent(b.agentId);
    if (!own) return json(res, 404, { error: 'No such agent on this phone.' });
    // A hand-off, or the model fallback for a phone with no model of its own.
    const perms = own.rec.package.manifest.permissions || [];
    if (!perms.includes('handoff') && !(b.kind === 'model' && perms.includes('model'))) return json(res, 403, { error: 'This agent may not hand off.' });
    // Owner only: the phone is the owner's and the agent is the owner's.
    if (own.a.ownerId !== device.ownerId) return json(res, 403, { error: 'Hand-offs are for the owner\'s own agents.' });
    const cap = plans.planOf(owner).handoffsPerDay;
    if (!devices.takeHandoff(device.ownerId, cap)) return json(res, 429, { error: `Today's hand-off cap (${cap}) is used up.`, text: null });
    try {
      const r = await askClaude({ account: own.a.ownerId,
        model: 'sonnet', timeoutMs: 3 * 60 * 1000,
        system: `You answer one request from "${own.a.title}", a personal agent running on its owner's phone. Answer directly and briefly in plain text (no markdown headings), under 200 words unless the request asks for a specific format. You have no tools.`,
        prompt: String(b.prompt || '').slice(0, 8000),
      });
      return json(res, 200, { text: r.text.trim() });
    } catch (e) { return json(res, 502, { error: 'The Studio could not answer just now.', text: null }); }
  }
  return json(res, 404, { error: 'not found' });
}

// ---- start, resume, stop --------------------------------------------------------------
auth.ensureAdmin();
for (const a of store.listAgents()) {
  if (a.status === 'running') { a.status = 'paused'; a.autoResume = true; store.saveAgent(a); }
}
setTimeout(() => {
  for (const a of store.listAgents()) {
    if (!a.autoResume) continue;
    a.autoResume = false;
    store.saveAgent(a);
    try { crew.resume(a); console.log(`  resumed ${a.title}`); } catch (e) { console.error(`resume ${a.id}: ${e.message}`); }
  }
}, 8000);
scheduler.start({ onCloudRun: afterRun });
telegram.start().catch((e) => console.error(`telegram: ${e.message}`));

let stopping = false;
async function gracefulStop(signal) {
  if (stopping) return;
  stopping = true;
  const active = bus.allRunning();
  for (const id of active) { const a = store.loadAgent(id); if (a) { a.autoResume = true; store.saveAgent(a); } bus.stop(id); }
  console.log(`\n  ${signal}: ${active.length} run(s) finishing their current turn…`);
  const deadline = Date.now() + 14 * 60 * 1000;
  while (Date.now() < deadline && bus.allRunning().length) await new Promise((r) => setTimeout(r, 2000));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => gracefulStop('SIGTERM'));
process.on('SIGINT', () => gracefulStop('SIGINT'));

server.listen(PORT, () => console.log(`\n  Pocket Box is running at http://localhost:${PORT} (public ${BASE_URL})\n`));
