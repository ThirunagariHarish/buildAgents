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
const { askClaude } = require('./lib/claude');
const { PERMISSIONS } = require('./lib/kit/core');

const { PORT, BASE_URL } = config;
const PUBLIC_DIR = path.join(__dirname, 'public');
const KIT_CORE = path.join(__dirname, 'lib', 'kit', 'core.js');
const COOKIE = 'pb_session';
const DOWNLOADS = path.join(config.DATA, 'downloads');
function appBuilds() {
  try { return { android: JSON.parse(fs.readFileSync(path.join(DOWNLOADS, 'pocket.json'), 'utf8')) }; } catch { return { android: null }; }
}

// ---- helpers ------------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => {
    const i = c.indexOf('=');
    return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }));
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
const sessionCookie = (req, value, maxAge) => `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}`;
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const currentUser = (req) => auth.userForSession(cookies(req)[COOKIE]);
const isAdmin = (u) => !!u && u.role === 'admin';
const canSee = (u, a) => !!a && (isAdmin(u) || a.ownerId === u.id);

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
    ownerName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : null,
    running: bus.running(a.id), thinking: bus.thinking(a.id), needsYou: store.needsYou(a),
    package: rec ? { version: manifest.version, channel: rec.channel, publishedAt: rec.publishedAt, permissions: manifest.permissions, triggers: manifest.triggers, http: manifest.http || null, evals: rec.package.evals, history: rec.history, commit: rec.package.commit } : null,
    settings: manifest ? settings.view(a.id, manifest) : [],
  };
}

// ---- server ------------------------------------------------------------------------
const PUBLIC_API = new Set(['/api/session', '/api/login', '/api/logout', '/api/signup', '/api/forgot', '/api/reset']);

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
      return json(res, 200, { authed: !!u, user: auth.publicUser(u), version: APP_VERSION, mailConfigured: mail.configured() });
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
        const { user, duplicate } = auth.signup({ ...body, ip });
        if (!duplicate) {
          push.broadcast({ title: 'Access request', body: `${user.firstName} ${user.lastName} asked to join Pocket Box.`, url: '/#/people', tag: `signup:${user.id}` }, auth.admins().map((x) => x.id)).catch(() => {});
          for (const ad of auth.admins()) mail.send({ to: ad.email, subject: `Pocket Box access request: ${user.firstName} ${user.lastName}`, text: `${user.firstName} ${user.lastName} (${user.email}, ${user.phone}) asked for access.\n\nApprove in Pocket Box → People: ${BASE_URL}/#/people\n` }).catch(() => {});
        }
        return json(res, 200, { ok: true, message: 'Thanks. The administrator will review your request; you will get a link to set your password once it is approved.' });
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

    // ---- the Android app, built by CI and copied here ----
    if (p === '/download/pocket.apk' && (req.method === 'GET' || req.method === 'HEAD')) {
      const apk = path.join(DOWNLOADS, 'pocket.apk');
      if (!fs.existsSync(apk)) { res.writeHead(404); return res.end('Not built yet.'); }
      res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="Pocket.apk"', 'Content-Length': fs.statSync(apk).size, 'Cache-Control': 'no-store' });
      return fs.createReadStream(apk).pipe(res);
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
    bus.attach(res, user);
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
  if (p === '/api/me/about') {
    if (req.method === 'GET') return json(res, 200, { about: room.aboutMe(user.id) });
    if (req.method === 'POST') { const b = await readBody(req).catch(() => ({})); room.setAboutMe(user.id, b.about); return json(res, 200, { ok: true }); }
  }

  // ---- administration ----
  if (p.startsWith('/api/admin/')) {
    if (!isAdmin(user)) return json(res, 403, { error: 'Administrators only.' });
    if (p === '/api/admin/users' && req.method === 'GET') return json(res, 200, { users: auth.listUsers(), mailConfigured: mail.configured() });
    const m = p.match(/^\/api\/admin\/users\/([a-f0-9]+)\/(approve|decline|disable|enable|resend|make-admin|remove-admin)$/);
    if (m && req.method === 'POST') {
      const [, id, act] = m;
      try {
        if (act === 'make-admin' || act === 'remove-admin') {
          if (!user.primary) return json(res, 403, { error: 'Only the primary administrator can change roles.' });
          auth.setRole(id, act === 'make-admin' ? 'admin' : 'user');
        } else if (id === user.id) return json(res, 400, { error: 'You cannot change your own account here.' });
        else if (act === 'approve' || act === 'resend') {
          const { user: u, token } = auth.approve(id);
          const r = await sendSetPasswordMail(u, token, 'approved');
          bus.broadcast({ event: 'users' }, { adminsOnly: true });
          return json(res, 200, { ok: true, emailed: r.sent, link: r.sent ? null : r.link });
        } else if (act === 'decline') auth.decline(id);
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
  if (p === '/api/devices' && req.method === 'GET') return json(res, 200, { devices: devices.list(user.id), apps: appBuilds() });
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

  // ---- agents ----
  if (p === '/api/agents' && req.method === 'GET') {
    return json(res, 200, { agents: store.listAgents().filter((a) => canSee(user, a)).map((a) => ({ ...store.summary(a), running: bus.running(a.id), mine: a.ownerId === user.id })) });
  }
  if (p === '/api/agents' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    if (!String(b.idea || '').trim()) return json(res, 400, { error: 'Describe the agent you want.' });
    if (auth.limited(`create:${user.id}`, 30, 3600 * 1000)) return json(res, 429, { error: 'Too many new agents in an hour.' });
    const a = store.createAgent({ ownerId: user.id, idea: b.idea, template: room.TEMPLATES[b.template] ? b.template : null, rounds: b.rounds });
    room.runRoom(a);
    return json(res, 201, agentView(store.loadAgent(a.id), user));
  }
  const am = p.match(/^\/api\/agents\/([a-f0-9]{12})(?:\/([a-z-]+))?(?:\/([a-f0-9]{10}))?(?:\/([a-z]+))?$/);
  if (!am) return json(res, 404, { error: 'not found' });
  const [, id, action, sub, subAction] = am;
  const a = store.loadAgent(id);
  if (!canSee(user, a)) return json(res, 404, { error: 'No such agent.' });

  if (!action && req.method === 'GET') return json(res, 200, agentView(a, user));
  if (!action && req.method === 'PATCH') {
    const b = await readBody(req).catch(() => ({}));
    if (b.title) { a.title = String(b.title).slice(0, 40); store.saveAgent(a); }
    return json(res, 200, agentView(a, user));
  }
  if (!action && req.method === 'DELETE') {
    bus.stop(a.id);
    try { packages.setChannel(a.id, 'off'); } catch {}
    store.deleteAgent(a.id);
    bus.publish(a, { event: 'deleted' });
    return json(res, 200, { ok: true });
  }
  if (action === 'message' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    const text = String(b.text || '').trim().slice(0, 4000);
    if (!text) return json(res, 400, { error: 'Write something first.' });
    const msg = store.addMessage(a, { agentId: 'owner', agentName: 'You', kind: 'owner', summary: text.slice(0, 160), content: text });
    store.saveAgent(a);
    bus.publish(a, { event: 'message', message: msg });
    crew.onOwnerMessage(store.loadAgent(a.id), text).catch((e) => console.error(`note ${a.id}: ${e.message}`));
    return json(res, 201, msg);
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
      handoff: { used: devices.handoffUsage(device.ownerId), cap: config.HANDOFF_DAILY_CAP },
      agents: list.map(({ a, rec }) => ({
        agentId: a.id, title: a.title, icon: a.icon || null, channel: rec.channel,
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
    const a = store.loadAgent(own.a.id);
    a.lastRun = { at: run.at, ok: run.ok, channel: run.channel, summary: run.notifications[0] ? run.notifications[0].title : run.ok ? 'Ran, nothing to say' : 'Failed' };
    store.saveAgent(a);
    bus.publish(a, { event: 'run', run });
    return json(res, 201, { ok: true, id: run.id });
  }
  if (p === '/api/device/http' && req.method === 'POST') {
    const b = await readBody(req).catch(() => ({}));
    const own = ownAgent(b.agentId);
    if (!own) return json(res, 404, { error: 'No such agent on this phone.' });
    if (!(own.rec.package.manifest.permissions || []).includes('http')) return json(res, 403, { error: 'This agent may not read the web.' });
    return json(res, 200, await devices.httpGet(own.rec.package.manifest, b.url));
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
    if (!devices.takeHandoff(device.ownerId)) return json(res, 429, { error: `Today's hand-off cap (${config.HANDOFF_DAILY_CAP}) is used up.`, text: null });
    try {
      const r = await askClaude({
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
scheduler.start();

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
