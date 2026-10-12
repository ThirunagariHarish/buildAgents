// Run Scenario — a research desk for market claims. You state a claim; a
// strategist makes it measurable, analysts gather data (prices, macro,
// crowd, news, filings), a judge commits to one probability, and the desk
// re-runs it every day so you can watch the claim firm up or fall apart.
//
// Zero dependencies (Node 22). Accounts come from Pocket Box.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const config = require('./lib/config');
const auth = require('./lib/auth');
const mail = require('./lib/mail');
const store = require('./lib/store');
const desk = require('./lib/desk');
const data = require('./lib/data');
const models = require('./lib/models');

const { PORT, BASE_URL } = config;
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'sc_session';

// ---- helpers ----------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req, limit = 64000) {
  return new Promise((resolve, reject) => {
    let d = '', done = false;
    req.on('data', (c) => { if (done) return; d += c; if (d.length > limit) { done = true; reject(Object.assign(new Error('Too large.'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { if (done) return; done = true; try { resolve(d ? JSON.parse(d) : {}); } catch { reject(Object.assign(new Error('Not valid JSON.'), { status: 400 })); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => { const i = c.indexOf('='); return i < 0 ? [c.trim(), ''] : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())]; }));
}
const isHttps = (req) => req.headers['x-forwarded-proto'] === 'https';
const sessionCookie = (req, v, maxAge) => `${COOKIE}=${v}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}`;
const OUR_PROXIES = new Set(['2.25.157.104', '69.62.86.166']);
const isOurs = (ip) => { ip = String(ip || '').replace(/^::ffff:/, ''); return OUR_PROXIES.has(ip) || ip === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|fd|fc)/i.test(ip); };
const clientIp = (req) => {
  const peer = String(req.socket.remoteAddress || '');
  if (!isOurs(peer)) return peer.replace(/^::ffff:/, '');
  const hops = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!isOurs(hops[i]) || i === 0) return hops[i].replace(/^::ffff:/, '');
  return peer.replace(/^::ffff:/, '');
};
// The desk runs on the owner's Claude login, so it is for administrators only.
const allowed = (u) => !!u && (u.role === 'admin' || process.env.SC_ALLOW_ALL === '1');
const currentUser = (req) => auth.userForSession(cookies(req)[COOKIE]);

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function crossSiteWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const origin = req.headers.origin || '';
  if (!origin) return false;
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  try { return new URL(origin).host !== host; } catch { return true; }
}

// ---- static -----------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const VERSION = (() => { const h = crypto.createHash('sha256'); for (const f of fs.readdirSync(PUBLIC_DIR)) { try { h.update(fs.readFileSync(path.join(PUBLIC_DIR, f))); } catch {} } return h.digest('hex').slice(0, 12); })();
function serveStatic(req, res, p) {
  const rel = p === '/' ? '/index.html' : p;
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    // Client-side routes fall back to the app.
    if (!path.extname(p)) return serveStatic(req, res, '/');
    res.writeHead(404); return res.end('not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache', ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
  if (ext === '.html') return res.end(fs.readFileSync(file, 'utf8').replace(/(src|href)="([a-z-]+\.(?:js|css))"/g, `$1="$2?v=${VERSION}"`));
  fs.createReadStream(file).pipe(res);
}

// ---- live updates -------------------------------------------------------------
const streams = new Map(); // res -> token
function emit(payload) {
  const sc = payload.id ? store.load(payload.id) : null;
  for (const [res, token] of streams) {
    const u = auth.userForSession(token);
    if (!u || !allowed(u)) { streams.delete(res); try { res.end(); } catch {} continue; }
    if (sc && sc.ownerId !== u.id && u.role !== 'admin') continue;
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch {}
  }
}

// ---- the queue: one desk run at a time ------------------------------------------
const queue = [];
let busy = false;
function enqueue(id, reason) {
  if (queue.some((q) => q.id === id) || desk.isRunning(id)) return false;
  queue.push({ id, reason });
  const sc = store.load(id);
  if (sc && sc.status !== 'running') { store.patch(id, { status: 'queued' }); emit({ event: 'scenario', id }); }
  pump();
  return true;
}
async function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  try {
    const r = await desk.run(next.id, { emit, reason: next.reason });
    if (r && next.reason === 'daily') await alert(r).catch((e) => console.error(`alert ${next.id}: ${e.message}`));
  } catch (e) { console.error(`run ${next.id}: ${e.message}`); }
  busy = false;
  setImmediate(pump);
}

/** Email the owner when a daily run moved the needle. */
async function alert({ sc, run, prev }) {
  if (!sc.alerts || !sc.alerts.email || !prev) return;
  const dp = run.probability - prev.probability;
  const moved = Math.abs(dp) >= (sc.alerts.move || 5) || prev.verdict !== run.verdict || sc.status === 'resolved';
  if (!moved) return;
  const u = auth.getUser(sc.ownerId);
  if (!u) return;
  const lines = [
    `${sc.thesis.title}`, '',
    `${prev.probability}% → ${run.probability}%  (${dp >= 0 ? '+' : ''}${dp} pts)  ${run.verdict}`, '',
    run.call, '',
    ...(run.changes || []).slice(0, 6).map((c) => `• ${c.text}`), '',
    `Open the dashboard: ${BASE_URL}/#/s/${sc.id}`, '',
    'Research, not financial advice.',
  ];
  await mail.send({ to: u.email, subject: `${sc.thesis.title}: ${run.probability}% (${dp >= 0 ? '+' : ''}${dp})`, text: lines.join('\n') });
}

// ---- daily schedule ------------------------------------------------------------
function tick() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < config.DAILY_HOUR_UTC) return;
  for (const sc of store.list()) {
    if (sc.schedule !== 'daily' || ['resolved', 'running', 'queued'].includes(sc.status) || !sc.thesis) continue;
    if ((sc.lastRunDate || '') >= date) continue;
    enqueue(sc.id, 'daily');
  }
}

// ---- views ---------------------------------------------------------------------
function card(sc) {
  const h = sc.history || [];
  const last = h[h.length - 1], prev = h[h.length - 2];
  return {
    id: sc.id, title: sc.thesis ? sc.thesis.title : sc.claim, claim: sc.claim, themeId: sc.themeId, parentId: sc.parentId, status: sc.status, error: sc.error,
    probability: last ? last.p : null, change: last && prev ? Math.round((last.p - prev.p) * 10) / 10 : null, verdict: sc.latest ? sc.latest.verdict : null,
    horizonDate: sc.thesis ? sc.thesis.horizonDate : null, spark: [...(sc.backfill || []).map((b) => b.p), ...h.map((x) => x.p)].slice(-40),
    updatedAt: sc.latest ? sc.latest.at : sc.createdAt, createdAt: sc.createdAt,
  };
}
function fullView(sc, user) {
  const latest = sc.latest ? store.loadRun(sc.id, sc.latest.id) : null;
  const seenId = (sc.seen || {})[user.id];
  let sinceVisit = null;
  if (latest && seenId && seenId !== latest.id) {
    const seenRun = store.loadRun(sc.id, seenId);
    if (seenRun) sinceVisit = { from: seenRun.date, fromP: seenRun.probability, changes: desk.diff(seenRun, latest) };
  }
  const runs = (sc.history || []).map((h) => ({ date: h.date, p: h.p, runId: h.runId }));
  const theme = store.list().filter((x) => x.themeId === sc.themeId && x.id !== sc.id).map(card);
  return { ...card(sc), thesis: sc.thesis, facts: sc.facts, history: sc.history, backfill: sc.backfill, questions: sc.questions, schedule: sc.schedule, alerts: sc.alerts, resolved: sc.resolved || null, latest, sinceVisit, runs, theme, progress: desk.progress(sc.id), queued: queue.some((q) => q.id === sc.id) };
}
const mine = (u, sc) => !!sc && (sc.ownerId === u.id || u.role === 'admin');

let statusCache = null;
async function status(force) {
  if (!force && statusCache && Date.now() - statusCache.at < 3600 * 1000) return statusCache;
  statusCache = { at: Date.now(), sources: await data.probe(), models: (await models.available()) ? models.info() : null, mail: mail.configured(), daily: `${config.DAILY_HOUR_UTC}:00 UTC` };
  return statusCache;
}

// ---- server ----------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  securityHeaders(req, res);
  try {
    if (p.startsWith('/api/') && crossSiteWrite(req)) return json(res, 403, { error: 'Cross-site request refused.' });
    const ip = clientIp(req);
    if (p === '/api/session' && req.method === 'GET') {
      const u = currentUser(req);
      return json(res, 200, { authed: !!u, allowed: allowed(u), user: auth.publicUser(u), version: VERSION });
    }
    if (p === '/api/login' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try {
        const u = auth.login({ email: b.email, password: b.password, ip });
        res.setHeader('Set-Cookie', sessionCookie(req, auth.createSession(u, req.headers['user-agent']), 30 * 24 * 3600));
        return json(res, 200, { ok: true, allowed: allowed(u) });
      } catch (e) { return json(res, e.status || 500, { error: e.status ? e.message : 'Sign-in failed.' }); }
    }
    if (p === '/api/logout' && req.method === 'POST') {
      auth.destroySession(cookies(req)[COOKIE]);
      res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/forgot' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      try {
        const r = auth.forgot({ email: b.email, ip });
        if (r) mail.send({ to: r.user.email, subject: 'Set your Run Scenario password', text: `Hi ${r.user.firstName},\n\nUse this link to set your Run Scenario password (one use, 24 hours):\n\n${BASE_URL}/#/reset/${r.token}\n\nIf you didn't ask for this, ignore this email.\n` }).catch(() => {});
        return json(res, 200, { ok: true, message: 'If that address has an account, a link is on its way. Check Spam too.' });
      } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (p === '/api/reset' && req.method === 'GET') { const u = auth.tokenUser(url.searchParams.get('token')); return json(res, 200, { valid: !!u, email: u?.email || null }); }
    if (p === '/api/reset' && req.method === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      if (auth.limited(`reset:ip:${ip}`, 10, 3600 * 1000)) return json(res, 429, { error: 'Too many attempts.' });
      try { const u = auth.resetPassword({ token: b.token, password: b.password }); return json(res, 200, { ok: true, email: u.email }); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
    }
    if (!p.startsWith('/api/')) return serveStatic(req, res, p);

    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'Sign in to continue.', login: true });
    if (!allowed(user)) return json(res, 403, { error: 'Run Scenario is invite-only for now.' });
    return await api(req, res, p, url, user);
  } catch (e) {
    console.error(`${req.method} ${p}: ${e.stack || e.message}`);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on the server.' });
  }
});

async function api(req, res, p, url, user) {
  if (p === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ event: 'hello', version: VERSION })}\n\n`);
    streams.set(res, cookies(req)[COOKIE]);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => { clearInterval(ping); streams.delete(res); });
    return;
  }
  if (p === '/api/status' && req.method === 'GET') return json(res, 200, await status(url.searchParams.get('fresh') === '1'));
  if (p === '/api/scenarios' && req.method === 'GET') {
    const list = store.list().filter((sc) => mine(user, sc)).map(card).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return json(res, 200, { scenarios: list, running: queue.length + (busy ? 1 : 0) });
  }
  if (p === '/api/scenarios' && req.method === 'POST') {
    const b = await readBody(req);
    const claim = String(b.claim || '').trim().slice(0, 600);
    const facts = String(b.facts || '').trim().slice(0, 3000);
    if (claim.length < 6) return json(res, 400, { error: 'Say the claim in a sentence.' });
    if (auth.limited(`create:${user.id}`, 30, 24 * 3600 * 1000)) return json(res, 429, { error: 'That\'s a lot of new scenarios today. Try again tomorrow.' });
    const parent = b.parentId ? store.load(b.parentId) : null;
    const sc = store.create({ ownerId: user.id, claim, facts, themeId: parent && mine(user, parent) ? parent.themeId : null, parentId: parent ? parent.id : null });
    enqueue(sc.id, 'new');
    return json(res, 200, { id: sc.id });
  }
  const m = p.match(/^\/api\/scenarios\/([a-z0-9]{10,16})(\/[\w/-]+)?$/);
  if (!m) return json(res, 404, { error: 'Not found.' });
  const sc = store.load(m[1]);
  if (!mine(user, sc)) return json(res, 404, { error: 'No such scenario.' });
  const sub = m[2] || '';
  if (sub === '' && req.method === 'GET') return json(res, 200, fullView(sc, user));
  if (sub === '' && req.method === 'DELETE') { store.remove(sc.id); return json(res, 200, { ok: true }); }
  if (sub === '' && req.method === 'PATCH') {
    const b = await readBody(req);
    const f = {};
    if (['daily', 'off'].includes(b.schedule)) f.schedule = b.schedule;
    if (b.alerts && typeof b.alerts === 'object') f.alerts = { email: !!b.alerts.email, move: Math.max(1, Math.min(50, Number(b.alerts.move) || 5)) };
    return json(res, 200, card(store.patch(sc.id, f)));
  }
  if (sub === '/seen' && req.method === 'POST') {
    if (sc.latest) { const fresh = store.load(sc.id); fresh.seen = { ...(fresh.seen || {}), [user.id]: sc.latest.id }; store.save(fresh); }
    return json(res, 200, { ok: true });
  }
  if (sub === '/run' && req.method === 'POST') {
    if (auth.limited(`run:${sc.id}`, 6, 3600 * 1000)) return json(res, 429, { error: 'It has run a lot this hour. Try later.' });
    // A scenario whose framing failed starts over from the claim.
    if (sc.status === 'error' && !sc.latest) store.patch(sc.id, { thesis: null });
    return json(res, 200, { queued: enqueue(sc.id, 'manual') });
  }
  const rm = sub.match(/^\/runs\/([\w-]{6,40})$/);
  if (rm && req.method === 'GET') { const r = store.loadRun(sc.id, rm[1]); return r ? json(res, 200, r) : json(res, 404, { error: 'No such run.' }); }
  if (sub === '/ask' && req.method === 'POST') {
    const b = await readBody(req);
    const q = String(b.q || '').trim().slice(0, 600);
    if (q.length < 4) return json(res, 400, { error: 'Ask a question.' });
    if (auth.limited(`ask:${user.id}`, 40, 24 * 3600 * 1000)) return json(res, 429, { error: 'Too many questions today.' });
    const item = { id: crypto.randomBytes(5).toString('hex'), q, at: Date.now(), status: 'thinking', steps: [] };
    const fresh = store.load(sc.id); fresh.questions = [...(fresh.questions || []), item].slice(-40); store.save(fresh);
    json(res, 200, item);
    const update = (fields) => { const s = store.load(sc.id); if (!s) return; s.questions = s.questions.map((x) => (x.id === item.id ? { ...x, ...fields } : x)); store.save(s); emit({ event: 'question', id: sc.id, qid: item.id }); };
    desk.ask(store.load(sc.id), q, (step) => emit({ event: 'qstep', id: sc.id, qid: item.id, text: step }))
      .then((a) => update({ status: 'done', answer: a.answer, sources: a.sources, track: a.track }))
      .catch((e) => update({ status: 'error', answer: `Couldn't answer: ${e.message.slice(0, 200)}` }));
    return;
  }
  return json(res, 404, { error: 'Not found.' });
}

// ---- start -----------------------------------------------------------------------------
auth.ensureAdmin();
// Runs cut off by a restart go back in the queue.
for (const sc of store.list()) if (['running', 'queued'].includes(sc.status)) { store.patch(sc.id, { status: sc.latest ? 'ready' : 'new' }); enqueue(sc.id, 'resume'); }
setInterval(tick, 10 * 60 * 1000);
setTimeout(tick, 30 * 1000);
server.listen(PORT, () => console.log(`\n  Run Scenario on http://localhost:${PORT} (public ${BASE_URL})\n`));
